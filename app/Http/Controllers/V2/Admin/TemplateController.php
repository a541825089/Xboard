<?php

namespace App\Http\Controllers\V2\Admin;

use App\Http\Controllers\Controller;
use App\Models\Server;
use App\Models\ServerGroup;
use App\Models\ServerMachine;
use App\Protocols\General;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class TemplateController extends Controller
{
    public function createSocksRealityRelay(Request $request)
    {
        $params = $request->validate([
            'socks_host' => 'required|string|max:255',
            'socks_port' => 'required|integer|min:1|max:65535',
            'socks_username' => 'nullable|string|max:255',
            'socks_password' => 'nullable|string|max:255',
            'machine_id' => 'required|integer|exists:v2_server_machine,id',
            'node_host' => 'required|string|max:255',
            'group_ids' => 'required|array|min:1',
            'group_ids.*' => 'integer|exists:v2_server_group,id',
            'name' => 'nullable|string|max:255',
            'server_name' => 'nullable|string|max:255',
        ]);

        $machine = ServerMachine::findOrFail((int) $params['machine_id']);
        if (!$machine->is_active) {
            return $this->fail([422, '所选运行机器未启用']);
        }

        try {
            $probe = $this->probeSocks5(
                trim($params['socks_host']),
                (int) $params['socks_port'],
                (string) ($params['socks_username'] ?? ''),
                (string) ($params['socks_password'] ?? '')
            );
        } catch (\Throwable $e) {
            return $this->fail([422, 'SOCKS5 检测失败'], null, $e->getMessage());
        }

        try {
            [$privateKey, $publicKey] = $this->generateRealityKeyPair();
            $shortId = bin2hex(random_bytes(8));
            $port = $this->findAvailablePort((int) $params['machine_id'], trim($params['node_host']));
            $serverName = trim((string) ($params['server_name'] ?? '')) ?: 'www.cloudflare.com';
            $nodeName = trim((string) ($params['name'] ?? '')) ?: 'VLESS Reality 高速中转';

            $node = DB::transaction(function () use ($params, $port, $serverName, $nodeName, $privateKey, $publicKey, $shortId) {
                $node = new Server();
                $node->type = Server::TYPE_VLESS;
                $node->name = $nodeName;
                $node->host = trim($params['node_host']);
                $node->port = (string) $port;
                $node->server_port = $port;
                $node->rate = 1;
                $node->show = true;
                $node->enabled = true;
                $node->machine_id = (int) $params['machine_id'];
                $node->group_ids = array_map('strval', array_values(array_unique($params['group_ids'])));
                $node->route_ids = [];
                $node->tags = ['vless', 'reality', 'relay'];
                $node->protocol_settings = [
                    'tls' => 2,
                    'network' => 'tcp',
                    'flow' => 'xtls-rprx-vision',
                    'tls_settings' => ['server_name' => null, 'allow_insecure' => false],
                    'reality_settings' => [
                        'server_name' => $serverName,
                        'server_port' => 443,
                        'public_key' => $publicKey,
                        'private_key' => $privateKey,
                        'short_id' => $shortId,
                        'allow_insecure' => false,
                    ],
                    'multiplex' => ['enabled' => false],
                    'utls' => ['enabled' => true, 'fingerprint' => 'chrome'],
                ];
                $node->custom_outbounds = [[
                    'tag' => 'direct',
                    'protocol' => 'socks',
                    'settings' => [
                        'server' => trim($params['socks_host']),
                        'server_port' => (int) $params['socks_port'],
                        'username' => (string) ($params['socks_username'] ?? ''),
                        'password' => (string) ($params['socks_password'] ?? ''),
                        'version' => '5',
                    ],
                ]];
                // sing-box uses the outbound tagged "direct" as its final route.
                // Xray-style inboundTag/outboundTag rules must not be generated here.
                $node->custom_routes = [];
                $node->save();
                return $node;
            });

            $subscription = General::buildVless('00000000-0000-4000-8000-000000000000', array_merge(
                $node->toArray(),
                ['password' => '00000000-0000-4000-8000-000000000000']
            ));
            $secrets = [
                trim($params['socks_host']),
                (string) ($params['socks_username'] ?? ''),
                (string) ($params['socks_password'] ?? ''),
                'socks',
            ];
            foreach ($secrets as $secret) {
                if ($secret !== '' && stripos($subscription, $secret) !== false) {
                    $node->delete();
                    throw new \RuntimeException('订阅安全检查未通过，节点已回滚');
                }
            }

            return $this->success([
                'node_id' => $node->id,
                'name' => $node->name,
                'protocol' => 'vless',
                'security' => 'reality',
                'host' => $node->host,
                'port' => $port,
                'machine_id' => $node->machine_id,
                'exit_ip' => $probe['exit_ip'],
                'socks5_check' => 'passed',
                'subscription_check' => 'passed',
            ]);
        } catch (\Throwable $e) {
            return $this->fail([500, '创建中转节点失败'], null, $e->getMessage());
        }
    }

    private function generateRealityKeyPair(): array
    {
        if (!function_exists('sodium_crypto_box_keypair')) {
            throw new \RuntimeException('服务器缺少 Sodium 扩展，无法生成 Reality 密钥');
        }
        $pair = sodium_crypto_box_keypair();
        return [
            $this->base64UrlEncode(sodium_crypto_box_secretkey($pair)),
            $this->base64UrlEncode(sodium_crypto_box_publickey($pair)),
        ];
    }

    private function base64UrlEncode(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }

    private function findAvailablePort(int $machineId, string $nodeHost): int
    {
        $used = Server::where('machine_id', $machineId)
            ->pluck('server_port')
            ->map(fn ($port) => (int) $port)
            ->flip();
        $candidates = array_merge([443, 8443, 9443, 2443, 3443, 4443], range(20000, 20100));
        foreach ($candidates as $port) {
            if ($used->has($port)) {
                continue;
            }
            $socket = @stream_socket_client("tcp://{$nodeHost}:{$port}", $errno, $errstr, 0.35);
            if (is_resource($socket)) {
                fclose($socket);
                continue;
            }
            return $port;
        }
        throw new \RuntimeException('没有找到可用的节点端口');
    }

    private function probeSocks5(string $host, int $port, string $username, string $password): array
    {
        $socket = @stream_socket_client("tcp://{$host}:{$port}", $errno, $errstr, 8);
        if (!is_resource($socket)) {
            throw new \RuntimeException(trim($errstr ?: "无法连接 {$host}:{$port}"));
        }
        stream_set_timeout($socket, 10);
        try {
            $methods = ($username !== '' || $password !== '') ? "\x00\x02" : "\x00";
            $this->socketWrite($socket, "\x05" . chr(strlen($methods)) . $methods);
            $reply = $this->socketRead($socket, 2);
            if (ord($reply[0]) !== 5 || ord($reply[1]) === 255) {
                throw new \RuntimeException('SOCKS5 协议协商失败');
            }
            if (ord($reply[1]) === 2) {
                if (strlen($username) > 255 || strlen($password) > 255) {
                    throw new \RuntimeException('SOCKS5 账号或密码过长');
                }
                $this->socketWrite($socket, "\x01" . chr(strlen($username)) . $username . chr(strlen($password)) . $password);
                $auth = $this->socketRead($socket, 2);
                if (ord($auth[1]) !== 0) {
                    throw new \RuntimeException('SOCKS5 账号或密码错误');
                }
            } elseif (ord($reply[1]) !== 0) {
                throw new \RuntimeException('SOCKS5 认证方式不受支持');
            }

            $target = 'api.ipify.org';
            $this->socketWrite($socket, "\x05\x01\x00\x03" . chr(strlen($target)) . $target . pack('n', 80));
            $header = $this->socketRead($socket, 4);
            if (ord($header[1]) !== 0) {
                throw new \RuntimeException('SOCKS5 无法建立出口连接，错误码 ' . ord($header[1]));
            }
            $addressLength = match (ord($header[3])) {
                1 => 4,
                3 => ord($this->socketRead($socket, 1)),
                4 => 16,
                default => throw new \RuntimeException('SOCKS5 返回了未知地址类型'),
            };
            $this->socketRead($socket, $addressLength + 2);
            $this->socketWrite($socket, "GET /?format=text HTTP/1.1\r\nHost: api.ipify.org\r\nConnection: close\r\n\r\n");
            $response = '';
            while (!feof($socket) && strlen($response) < 65536) {
                $chunk = fread($socket, 8192);
                if ($chunk === false) break;
                $response .= $chunk;
            }
            [$headers, $body] = array_pad(preg_split("/\r?\n\r?\n/", $response, 2), 2, '');
            $exitIp = trim($body);
            if (!str_contains($headers, ' 200 ') || filter_var($exitIp, FILTER_VALIDATE_IP) === false) {
                throw new \RuntimeException('已连接 SOCKS5，但无法确认出口 IP');
            }
            return ['exit_ip' => $exitIp];
        } finally {
            fclose($socket);
        }
    }

    private function socketWrite($socket, string $data): void
    {
        $written = 0;
        while ($written < strlen($data)) {
            $count = fwrite($socket, substr($data, $written));
            if ($count === false || $count === 0) throw new \RuntimeException('SOCKS5 写入失败');
            $written += $count;
        }
    }

    private function socketRead($socket, int $length): string
    {
        $data = '';
        while (strlen($data) < $length) {
            $chunk = fread($socket, $length - strlen($data));
            if ($chunk === false || $chunk === '') throw new \RuntimeException('SOCKS5 响应不完整');
            $data .= $chunk;
        }
        return $data;
    }

    public function generateRelay(Request $request)
    {
        $params = $request->validate([
            'share_link' => 'required|string',
            'inbound_tag' => 'required|string',
            'relay_tag' => 'nullable|string',
            'name' => 'nullable|string',
        ]);

        $shareLink = trim($params['share_link']);
        $inboundTag = trim($params['inbound_tag']);
        $relayTag = isset($params['relay_tag']) && trim($params['relay_tag']) !== '' ? trim($params['relay_tag']) : 'relay';
        $name = isset($params['name']) && trim($params['name']) !== '' ? trim($params['name']) : "relay-{$relayTag}";

        try {
            $outbound = $this->parseShareLinkToOutbound($shareLink, $relayTag);
        } catch (\Exception $e) {
            return $this->fail([400, '解析分享链接失败'], null, $e->getMessage());
        }

        $rawRoute = [
            'name' => $name,
            'inboundTag' => [$inboundTag],
            'outboundTag' => $relayTag,
        ];

        $response = [
            'custom_outbounds' => [$outbound],
            'custom_routes' => [$rawRoute],
        ];

        return $this->success($response);
    }

    public function generateTemplates(Request $request)
    {
        $params = $request->validate([
            'domain' => 'nullable|string',
            'cert_present' => 'nullable|boolean',
            'all' => 'nullable|boolean',
        ]);

        $domain = isset($params['domain']) ? trim($params['domain']) : '';
        $cert = isset($params['cert_present']) ? (bool)$params['cert_present'] : false;
        $all = isset($params['all']) ? (bool)$params['all'] : false;

        $templates = [];

        // Always include VLESS + Reality (Vision) template (no cert required)
        $templates[] = [
            'name' => 'VLESS + Reality (Vision)',
            'protocol' => 'vless',
            'protocol_settings' => [
                'tls' => 0,
                'transport' => 'tcp',
                'reality' => [
                    'public_key' => '<RELAY_PUBLIC_KEY_BASE64>',
                    'short_ids' => ['<SHORT_ID>'],
                    'server_name' => $domain ?: '<SERVER_NAME>'
                ],
                'uuid' => '<UUID>'
            ],
            'notes' => '免证书 Reality 变体，替换 UUID 和 Reality keys 后可直接使用',
        ];

        // include gRPC variant
        $templates[] = [
            'name' => 'VLESS + Reality (gRPC)',
            'protocol' => 'vless',
            'protocol_settings' => [
                'tls' => 0,
                'transport' => 'grpc',
                'reality' => [
                    'public_key' => '<RELAY_PUBLIC_KEY_BASE64>',
                    'short_ids' => ['<SHORT_ID>'],
                    'server_name' => $domain ?: '<SERVER_NAME>'
                ],
                'uuid' => '<UUID>'
            ],
            'notes' => 'Reality 的 gRPC 变体；客户端需支持 gRPC transport',
        ];

        if ($cert || $all) {
            $templates[] = [
                'name' => 'Trojan + TLS',
                'protocol' => 'trojan',
                'protocol_settings' => [
                    'tls' => 1,
                    'tls_settings' => ['server_name' => $domain ?: '<SERVER_NAME>'],
                    'password' => '<PASSWORD>'
                ],
                'notes' => '需要域名和证书（可以用面板的 CertConfig）',
            ];

            $templates[] = [
                'name' => 'VMess + WS + TLS',
                'protocol' => 'vmess',
                'protocol_settings' => [
                    'tls' => 1,
                    'network' => 'ws',
                    'wsSettings' => ['path' => '/ws'],
                    'tls_settings' => ['server_name' => $domain ?: '<SERVER_NAME>']
                ],
                'notes' => '适合走 CDN 中转的场景，需要域名与证书',
            ];

            $templates[] = [
                'name' => 'Hysteria2 (QUIC)',
                'protocol' => 'hysteria2',
                'protocol_settings' => [
                    'tls' => 1,
                    'transport' => 'quic',
                    'tls_settings' => ['server_name' => $domain ?: '<SERVER_NAME>']
                ],
                'notes' => '基于 QUIC，速度快，需客户端支持 sing-box/NekoBox 等',
            ];
        }

        return $this->success(['templates' => $templates]);
    }

    public function testRelay(Request $request)
    {
        $params = $request->validate([
            'share_link' => 'required|string',
        ]);

        $shareLink = trim($params['share_link']);

        try {
            $outbound = $this->parseShareLinkToOutbound($shareLink, 'relay-test');
        } catch (\Exception $e) {
            return $this->fail([400, '解析分享链接失败'], null, $e->getMessage());
        }

        try {
            $endpoint = $this->extractEndpointFromOutbound($outbound);
        } catch (\Exception $e) {
            return $this->fail([400, '无法提取目标地址'], null, $e->getMessage());
        }

        $address = $endpoint['address'];
        $port = $endpoint['port'];
        $timeout = 5;

        $socket = @stream_socket_client(sprintf('tcp://%s:%d', $address, $port), $errno, $errstr, $timeout);
        if ($socket === false) {
            return $this->fail([502, '连通性测试失败'], null, trim($errstr ?: "连接 {$address}:{$port} 失败"));
        }
        fclose($socket);

        return $this->success(['host' => $address, 'port' => $port, 'status' => 'ok']);
    }

    private function extractEndpointFromOutbound(array $outbound): array
    {
        $settings = $outbound['settings'] ?? [];
        if (isset($settings['vnext']) && is_array($settings['vnext']) && count($settings['vnext']) > 0) {
            $target = $settings['vnext'][0];
            if (isset($target['address'], $target['port'])) {
                return ['address' => $target['address'], 'port' => (int)$target['port']];
            }
        }
        if (isset($settings['servers']) && is_array($settings['servers']) && count($settings['servers']) > 0) {
            $target = $settings['servers'][0];
            if (isset($target['address'], $target['port'])) {
                return ['address' => $target['address'], 'port' => (int)$target['port']];
            }
        }
        throw new \Exception('unsupported outbound settings for connectivity test');
    }

    private function parseShareLinkToOutbound(string $input, string $tag): array
    {
        $lower = strtolower(trim($input));
        if (str_starts_with($lower, 'vmess://')) {
            $raw = substr($input, 8);
            $decoded = $this->tryBase64Decode($raw);
            $obj = json_decode($decoded, true);
            if (!$obj) throw new \Exception('invalid vmess payload');
            $address = $obj['add'] ?? ($obj['address'] ?? null);
            $port = isset($obj['port']) ? (int)$obj['port'] : 0;
            $id = $obj['id'] ?? $obj['uuid'] ?? null;
            if (!$address || !$port || !$id) throw new \Exception('vmess 缺少字段');
            return ['tag' => $tag, 'protocol' => 'vmess', 'settings' => ['vnext' => [[ 'address' => $address, 'port' => $port, 'users' => [['id' => $id]] ]]]];
        }

        if (str_starts_with($lower, 'vless://') || str_starts_with($lower, 'trojan://') || str_starts_with($lower, 'socks://') || str_starts_with($lower, 'sk5://') || str_starts_with($lower, 'http://')) {
            $u = parse_url($input);
            if ($u === false || !isset($u['host'])) throw new \Exception('无法解析 URL');
            $host = $u['host'];
            $port = isset($u['port']) ? (int)$u['port'] : 0;
            $scheme = rtrim($u['scheme'], ':');
            if ($scheme === 'vless') {
                $id = $u['user'] ?? '';
                if ($id === '') throw new \Exception('vless 缺少 uuid');
                return ['tag' => $tag, 'protocol' => 'vless', 'settings' => ['vnext' => [[ 'address' => $host, 'port' => $port, 'users' => [['id' => $id]] ]]]];
            }
            if ($scheme === 'trojan') {
                $pass = $u['pass'] ?? '';
                return ['tag' => $tag, 'protocol' => 'trojan', 'settings' => ['servers' => [[ 'address' => $host, 'port' => $port, 'password' => $pass ]]]];
            }
            if ($scheme === 'socks' || $scheme === 'sk5' || $scheme === 'http') {
                $user = $u['user'] ?? null;
                $pass = $u['pass'] ?? null;
                $server = ['address' => $host, 'port' => $port];
                if ($user !== null || $pass !== null) $server['users'] = [['user' => $user ?? '', 'pass' => $pass ?? '']];
                $protocol = $scheme === 'sk5' ? 'socks' : $scheme;
                return ['tag' => $tag, 'protocol' => $protocol, 'settings' => ['servers' => [$server]]];
            }
        }

        if (str_starts_with($lower, 'ss://') || str_starts_with($lower, 'shadowsocks://')) {
            $raw = preg_replace('#^ss:|^shadowsocks:#i', '', $input);
            $raw = preg_replace('#^//#', '', $raw);
            if (str_contains($raw, '@')) {
                [$up, $hostpart] = explode('@', $raw, 2);
                if (str_contains($up, ':')) {
                    [$method, $password] = explode(':', $up, 2);
                } else {
                    // base64 encoded userinfo
                    $decoded = $this->tryBase64Decode($up);
                    if (!$decoded) throw new \Exception('无法解析 shadowsocks 用户部分');
                    [$method, $password] = explode(':', $decoded, 2);
                }
                [$host, $port] = explode(':', $hostpart, 2);
                return ['tag' => $tag, 'protocol' => 'shadowsocks', 'settings' => ['servers' => [[ 'address' => $host, 'port' => (int)$port, 'method' => $method, 'password' => $password ]]]];
            }
            $decoded = $this->tryBase64Decode($raw);
            if ($decoded) {
                if (str_contains($decoded, '@')) {
                    [$up, $hostpart] = explode('@', $decoded, 2);
                    [$method, $password] = explode(':', $up, 2);
                    [$host, $port] = explode(':', $hostpart, 2);
                    return ['tag' => $tag, 'protocol' => 'shadowsocks', 'settings' => ['servers' => [[ 'address' => $host, 'port' => (int)$port, 'method' => $method, 'password' => $password ]]]];
                }
            }
            throw new \Exception('无法解析 shadowsocks 链接');
        }

        throw new \Exception('不支持的分享链接协议');
    }

    private function tryBase64Decode(string $s): ?string
    {
        $s = trim($s);
        // normalize
        $s = str_replace(['-', '_'], ['+', '/'], $s);
        $mod4 = strlen($s) % 4;
        if ($mod4 > 0) {
            $s .= str_repeat('=', 4 - $mod4);
        }
        $decoded = @base64_decode($s, true);
        if ($decoded === false) return null;
        return $decoded;
    }
}


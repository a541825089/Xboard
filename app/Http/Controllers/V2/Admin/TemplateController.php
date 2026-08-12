<?php

namespace App\Http\Controllers\V2\Admin;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;

class TemplateController extends Controller
{
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

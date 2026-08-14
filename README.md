# Xboard（定制中转版）

本仓库是配合 [`a541825089/Xboard-Node`](https://github.com/a541825089/Xboard-Node) 使用的 Xboard 定制版本。生产部署已经在 Ubuntu 服务器、Docker Compose、Traefik HTTPS 反向代理环境中验证。

## 定制功能

- 节点管理页集成“XBoard 中转助手”统一入口；
- 一键输入 SOCKS5 地址、端口、账号和密码；
- 创建前检测 SOCKS5 连通性及出口 IP；
- 自动选择空闲端口、生成 Reality 密钥并创建 VLESS + Reality 节点；
- sing-box 自定义出站固定使用 `tag: direct`，不生成不兼容的自定义路由；
- SOCKS5 上游信息只保存在节点服务端配置，不进入用户订阅；
- 服务器 Token 安装命令从自有 Xboard-Node 仓库拉取源码并现场编译。

## 已验证的生产结构

- 系统：Ubuntu 24.04 LTS
- 项目目录：`/opt/xboard`
- 应用容器：`xboard-xboard-1`
- 应用镜像：由本仓库源码本地构建
- HTTPS：Traefik 负责 TLS 与反向代理
- Xboard-Node：机器模式、sing-box 内核、systemd 服务

域名、管理员路径、数据库密码、机器 Token 和证书均属于部署机私密配置，不应提交到 Git。

## Docker Compose 部署

### 1. 准备源码

```bash
sudo install -d -m 755 /opt/xboard
sudo git clone https://github.com/a541825089/Xboard.git /opt/xboard
cd /opt/xboard
```

### 2. 创建环境配置

```bash
cp .env.example .env
chmod 600 .env
```

根据实际环境编辑 `.env`。不要把 `.env`、数据库文件、Token 或备份文件提交到仓库。

### 3. 创建 Compose 配置

以仓库中的 `compose.sample.yaml` 或其他示例为基础创建生产文件：

```bash
cp compose.sample.yaml compose.yaml
```

生产环境建议：

- 使用持久化卷保存数据库及 Xboard 数据；
- `restart: unless-stopped`；
- 仅暴露反向代理所需端口；
- Xboard 与 Traefik 加入同一个外部 Docker 网络；
- TLS 证书及 Traefik 动态配置保存在项目目录之外。

### 4. 安装并启动

首次安装请使用强密码替换示例值：

```bash
docker compose run --rm \
  -e ENABLE_SQLITE=true \
  -e ENABLE_REDIS=true \
  -e ADMIN_ACCOUNT=admin@example.com \
  xboard php artisan xboard:install

docker compose up -d --build
```

### 5. 检查服务

```bash
docker compose ps
docker compose logs --tail=100 xboard
docker exec xboard-xboard-1 php artisan --version
```

## Traefik HTTPS

Traefik 应独立部署，通过外部 Docker 网络访问 Xboard。域名先解析到服务器，再为 Xboard 服务配置 HTTPS Router、证书解析器和应用内部端口。不要将真实域名、证书私钥或 DNS API Token 写入本仓库。

完成后检查：

```bash
curl -I https://panel.example.com
```

## 安装 Xboard-Node

在后台进入“服务器管理”，创建机器并打开“服务器 Token”。复制面板生成的命令到目标 Ubuntu 服务器执行。命令应从以下地址获取源码安装器：

```text
https://raw.githubusercontent.com/a541825089/Xboard-Node/dev/install-source.sh
```

安装器会克隆自有仓库、编译 `xboard-node` 和 `xbctl`，然后创建 systemd 服务。详细说明见 [`Xboard-Node`](https://github.com/a541825089/Xboard-Node)。

## SOCKS5 → VLESS + Reality 中转

进入“节点管理”，点击“XBoard 中转助手”：

### 批量导入 TXT

“一键中转”页面支持一次导入 1–30 个 SOCKS5 落地。每行格式为：

```text
VLESS入口地址:节点名称:运行机器SID:用户组ID:SOCKS5 IP:端口:用户:密码
```

示例：

```text
hk-entry.example.com:香港落地01:1:2,3:203.0.113.10:1080:user01:password01
hk-entry.example.com:香港落地02:3:2,3,4:203.0.113.11:1080:user02:password02
```

每一行分别绑定运行机器 SID 和用户组 ID；多个用户组 ID 使用英文逗号分隔，例如 `2,3,4`。Reality SNI 由本批次共用。系统按行顺序执行 SOCKS5 连通性检测、Reality 密钥生成和空闲端口分配，并为每行返回独立结果。空行和以 `#` 开头的注释行会被忽略。当前文本格式仅支持 IPv4 或域名；字段本身不能包含英文冒号。

1. 输入 SOCKS5 IP/域名、端口、账号和密码；
2. 选择运行机器（已部署 Xboard-Node 的服务器）；
3. 打开用户组下拉列表，勾选一个或多个用户组；已选用户组会显示为可单独移除的标签；
4. 填写 VLESS 对外地址、节点名称和 Reality SNI；
5. 点击检测并创建。

“用户组”决定哪些订阅用户能够看到并使用该 VLESS 节点。用户订阅只包含 VLESS + Reality 参数，不包含 SOCKS5 地址或认证信息。

## 更新部署

更新前先备份数据库、`.env` 和持久化数据：

```bash
cd /opt/xboard
git fetch origin
git pull --ff-only origin master
docker compose up -d --build
docker exec xboard-xboard-1 php artisan optimize:clear
docker compose ps
```

如果应用源码没有挂载进容器，必须重新构建镜像；只执行 `docker compose restart` 不会包含新的源码。

## 常用运维命令

```bash
cd /opt/xboard
docker compose ps
docker compose logs -f --tail=100 xboard
docker compose restart xboard
docker exec xboard-xboard-1 php artisan optimize:clear
docker exec xboard-xboard-1 php artisan migrate --force
```

## 安全注意事项

- 不提交 `.env`、`.env.*`、数据库备份、证书、Token、账号密码及临时备份文件；
- 机器 Token 泄露后应立即在后台重置；
- 更新前备份数据库和持久化卷；
- 仅为节点入口开放必要端口，管理面板始终使用 HTTPS；
- SOCKS5 凭据属于敏感信息，只应在管理端录入。

## License

MIT


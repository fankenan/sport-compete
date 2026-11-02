# -*- coding: utf-8 -*-
"""
把竞赛系统后端从内网机迁到腾讯云 150.158.39.237
步骤：建库 → 传代码 → 写 .env → 装依赖 → systemd → nginx 改代理
（数据另外导入，本脚本不导数据）
"""
import os
import paramiko

BASE = os.path.dirname(os.path.abspath(__file__))
LOCAL_SERVER = os.path.join(BASE, 'server')
REMOTE = '/opt/sport-compete'
SERVER_DIR = REMOTE + '/server'

KEY = os.path.expanduser('~/.ssh/id_ed25519_tencent')
cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect('150.158.39.237', 22, 'root', key_filename=KEY, timeout=30)


def run(cmd, t=600):
    _, o, e = cli.exec_command(cmd, timeout=t)
    out = o.read().decode('utf-8', 'replace').strip()
    err = e.read().decode('utf-8', 'replace').strip()
    return (out + ('\n' + err if err else '')).strip()


# 复用同机 sport_manage 的库密码
DB_PW = run("grep -E '^DB_PASSWORD=' /root/server/.env | cut -d= -f2-")
assert DB_PW, '没取到数据库密码'
print('数据库密码已取到（长度 %d）' % len(DB_PW))

SKIP_DIRS = {'node_modules', '.git', 'uploads', '__pycache__'}

print('\n===== 1. 建库 =====')
sql = f"""
CREATE DATABASE IF NOT EXISTS sport_compete CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
"""
print(run(f"mysql -uroot -p'{DB_PW}' -e \"{sql}\" 2>&1 | grep -v 'Using a password'") or '  库已创建')

print('\n===== 2. 传代码 =====')
sftp = cli.open_sftp()
run(f'mkdir -p {SERVER_DIR}/uploads')
count = [0]


def upload(local, remote):
    for name in os.listdir(local):
        if name in SKIP_DIRS or name == '.env':
            continue
        lp = os.path.join(local, name)
        rp = remote + '/' + name
        if os.path.isdir(lp):
            try:
                sftp.mkdir(rp)
            except IOError:
                pass
            upload(lp, rp)
        else:
            sftp.put(lp, rp)
            count[0] += 1


upload(LOCAL_SERVER, SERVER_DIR)
sftp.close()
print('  上传文件数:', count[0])

print('\n===== 3. 写 .env =====')
env = f"""PORT=4100
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD={DB_PW}
DB_NAME=sport_compete
JWT_SECRET=sport_compete_prod_2026_secret_key
"""
sftp = cli.open_sftp()
with sftp.open(SERVER_DIR + '/.env', 'w') as f:
    f.write(env)
sftp.close()
print('  .env 已写入')

print('\n===== 4. 导入表结构 =====')
out = run(f"cd {SERVER_DIR} && mysql -uroot -p'{DB_PW}' sport_compete < sql/schema.sql 2>&1 | grep -v 'Using a password'")
print('  ', out or '表结构已导入')
print('  表数量:', run(f"mysql -uroot -p'{DB_PW}' -N -e \"SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='sport_compete'\" 2>/dev/null"))

print('\n===== 5. 装依赖 =====')
print('  ', run(f'cd {SERVER_DIR} && npm install --production --silent 2>&1 | tail -3') or 'ok')
print('  版本:', run(f'cd {SERVER_DIR} && node -e "console.log(require(\'express/package.json\').version)"'))

print('\n===== 6. systemd 服务 =====')
unit = """[Unit]
Description=Sport Compete Backend (tencent)
After=network.target mariadb.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/sport-compete/server
EnvironmentFile=/opt/sport-compete/server/.env
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=5
StandardOutput=append:/var/log/sport-compete.log
StandardError=append:/var/log/sport-compete-error.log

[Install]
WantedBy=multi-user.target
"""
sftp = cli.open_sftp()
with sftp.open('/etc/systemd/system/sport-compete-backend.service', 'w') as f:
    f.write(unit)
sftp.close()
print(run('systemctl daemon-reload && systemctl enable sport-compete-backend 2>&1 | tail -1'))
print('  启动:', run('systemctl restart sport-compete-backend; sleep 4; systemctl is-active sport-compete-backend'))
print('  本地探测:', run('curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4100/api/health'))
print('  日志:', run('tail -3 /var/log/sport-compete.log 2>/dev/null || tail -5 /var/log/sport-compete-error.log'))

cli.close()
print('\n===== 完成 =====')

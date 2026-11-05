# -*- coding: utf-8 -*-
"""第三期后端部署：上传 trackRace.js / index.js 到内网机并重启"""
import os
import paramiko

# ---- 凭据从环境变量读取（不要写死在代码里）----
# 必填：SPORT_SSH_PASSWORD
# 选填：SPORT_SSH_HOST / SPORT_SSH_USER / SPORT_SUDO_PASSWORD / SPORT_DB_PASSWORD
_ENV = os.environ.copy()
_ENV['SPORT_SSH_HOST'] = os.environ.get('SPORT_SSH_HOST', '10.128.1.45')
_ENV['SPORT_SSH_USER'] = os.environ.get('SPORT_SSH_USER', 'single')
_ENV['SPORT_SSH_PASSWORD'] = os.environ.get('SPORT_SSH_PASSWORD', '')
_ENV['SPORT_SUDO_PASSWORD'] = os.environ.get('SPORT_SUDO_PASSWORD', '')
_ENV['SPORT_DB_PASSWORD'] = os.environ.get('SPORT_DB_PASSWORD', '')

if not _ENV['SPORT_SSH_PASSWORD']:
    raise SystemExit(
        '[安全] 缺少环境变量 SPORT_SSH_PASSWORD。\n'
        '  本脚本会连接真实服务器，凭据不再写在代码里。\n'
        '  请先 export SPORT_SSH_PASSWORD=... 后重试。'
    )


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
HOST = _ENV['SPORT_SSH_HOST']
USER = _ENV['SPORT_SSH_USER']
PWD  = _ENV['SPORT_SSH_PASSWORD']
REMOTE = '/home/single/sport-compete'

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, 22, USER, PWD, timeout=15)



def _env(name, fallback=None):
    """读环境变量；未设置时返回 fallback（可为 None 表示必须显式配置）"""
    return os.environ.get(name, fallback)


def _require_env(name):
    v = os.environ.get(name)
    if not v:
        raise SystemExit(
            '[安全] 缺少环境变量 %s。\n'
            '  本脚本会连接真实服务器/数据库，凭据不再写在代码里。\n'
            '  请先设置环境变量后重试。' % name
        )
    return v

def run(cmd, t=180):
    _, o, e = cli.exec_command(cmd, timeout=t, env=_ENV)
    return o.read().decode('utf-8', 'replace').strip(), e.read().decode('utf-8', 'replace').strip()


sftp = cli.open_sftp()
run(f'mkdir -p {REMOTE}/sql')
# 执行补漏迁移
for sqlf in ['migrate_track_phase3b.sql']:
    lp = os.path.join(BASE_DIR, 'sql', sqlf).replace('\\', '/')
    sftp.put(lp, f'{REMOTE}/sql/{sqlf}')
    o, e = run(f"""mysql -ucompete -pprocess.env.SPORT_DB_PASSWORD sport_compete < {REMOTE}/sql/{sqlf} 2>&1 | grep -v Warning""")
    print('迁移', sqlf, '->', o or e)

for f in ['routes/trackRace.js', 'index.js']:
    lp = os.path.join(BASE_DIR, 'server', f).replace('\\', '/')
    rp = f'{REMOTE}/server/{f}'
    sftp.put(lp, rp)
    print('uploaded', f)
sftp.close()

o, e = run(f'cd {REMOTE}/server && node --check routes/trackRace.js && node --check index.js && echo SYNTAX_OK')
print(o or e)

o, e = run('echo $SPORT_SUDO_PASSWORD | sudo -S systemctl restart sport-compete-backend && sleep 3 && systemctl is-active sport-compete-backend')
print('service:', o or e)

o, e = run('journalctl -u sport-compete-backend -n 25 --no-pager | grep -Ei "路由挂载|error|listen|4100" | tail -20')
print('--- 启动日志 ---')
print(o or e)

o, e = run('curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4100/ && echo " <- 首页"')
print(o or e)

cli.close()

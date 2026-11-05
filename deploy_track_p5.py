# -*- coding: utf-8 -*-
"""第五期部署：上传 trackPlan.js / timetable.js / index.js，重启"""
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
REMOTE = '/home/single/sport-compete'

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(_ENV['SPORT_SSH_HOST'], 22, _ENV['SPORT_SSH_USER'], _ENV['SPORT_SSH_PASSWORD'], timeout=15)


def run(cmd, t=180):
    _, o, e = cli.exec_command(cmd, timeout=t, env=_ENV)
    return o.read().decode('utf-8', 'replace').strip(), e.read().decode('utf-8', 'replace').strip()


sftp = cli.open_sftp()
for f in ['routes/trackPlan.js', 'services/timetable.js', 'index.js']:
    sftp.put(os.path.join(BASE_DIR, 'server', f).replace('\\', '/'), f'{REMOTE}/server/{f}')
    print('uploaded', f)
sftp.close()

o, e = run(f'cd {REMOTE}/server && node --check routes/trackPlan.js && node --check services/timetable.js && node --check index.js && echo SYNTAX_OK')
print(o or e)

o, e = run('echo $SPORT_SUDO_PASSWORD | sudo -S systemctl restart sport-compete-backend && sleep 3 && systemctl is-active sport-compete-backend')
print('service:', o or e)

o, e = run('journalctl -u sport-compete-backend -n 15 --no-pager | grep -Ei "路由|error|listen" | tail -12')
print('--- 启动日志 ---')
print(o or e)

o, e = run('curl -s http://127.0.0.1:4100/api/health')
print('health:', o or e)

cli.close()

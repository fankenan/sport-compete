# -*- coding: utf-8 -*-
"""第三期后端部署：上传 trackRace.js / index.js 到内网机并重启"""
import os
import paramiko

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
HOST, USER, PWD = '10.128.1.45', 'single', 'jyj2026'
REMOTE = '/home/single/sport-compete'

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, 22, USER, PWD, timeout=15)


def run(cmd, t=180):
    _, o, e = cli.exec_command(cmd, timeout=t)
    return o.read().decode('utf-8', 'replace').strip(), e.read().decode('utf-8', 'replace').strip()


sftp = cli.open_sftp()
run(f'mkdir -p {REMOTE}/sql')
# 执行补漏迁移
for sqlf in ['migrate_track_phase3b.sql']:
    lp = os.path.join(BASE_DIR, 'sql', sqlf).replace('\\', '/')
    sftp.put(lp, f'{REMOTE}/sql/{sqlf}')
    o, e = run(f"""mysql -ucompete -p'Compete@2026' sport_compete < {REMOTE}/sql/{sqlf} 2>&1 | grep -v Warning""")
    print('迁移', sqlf, '->', o or e)

for f in ['routes/trackRace.js', 'index.js']:
    lp = os.path.join(BASE_DIR, 'server', f).replace('\\', '/')
    rp = f'{REMOTE}/server/{f}'
    sftp.put(lp, rp)
    print('uploaded', f)
sftp.close()

o, e = run(f'cd {REMOTE}/server && node --check routes/trackRace.js && node --check index.js && echo SYNTAX_OK')
print(o or e)

o, e = run('echo jyj2026 | sudo -S systemctl restart sport-compete-backend && sleep 3 && systemctl is-active sport-compete-backend')
print('service:', o or e)

o, e = run('journalctl -u sport-compete-backend -n 25 --no-pager | grep -Ei "路由挂载|error|listen|4100" | tail -20')
print('--- 启动日志 ---')
print(o or e)

o, e = run('curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4100/ && echo " <- 首页"')
print(o or e)

cli.close()

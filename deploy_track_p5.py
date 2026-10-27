# -*- coding: utf-8 -*-
"""第五期部署：上传 trackPlan.js / timetable.js / index.js，重启"""
import os
import paramiko

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
REMOTE = '/home/single/sport-compete'

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect('10.128.1.45', 22, 'single', 'jyj2026', timeout=15)


def run(cmd, t=180):
    _, o, e = cli.exec_command(cmd, timeout=t)
    return o.read().decode('utf-8', 'replace').strip(), e.read().decode('utf-8', 'replace').strip()


sftp = cli.open_sftp()
for f in ['routes/trackPlan.js', 'services/timetable.js', 'index.js']:
    sftp.put(os.path.join(BASE_DIR, 'server', f).replace('\\', '/'), f'{REMOTE}/server/{f}')
    print('uploaded', f)
sftp.close()

o, e = run(f'cd {REMOTE}/server && node --check routes/trackPlan.js && node --check services/timetable.js && node --check index.js && echo SYNTAX_OK')
print(o or e)

o, e = run('echo jyj2026 | sudo -S systemctl restart sport-compete-backend && sleep 3 && systemctl is-active sport-compete-backend')
print('service:', o or e)

o, e = run('journalctl -u sport-compete-backend -n 15 --no-pager | grep -Ei "路由|error|listen" | tail -12')
print('--- 启动日志 ---')
print(o or e)

o, e = run('curl -s http://127.0.0.1:4100/api/health')
print('health:', o or e)

cli.close()

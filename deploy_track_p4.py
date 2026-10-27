# -*- coding: utf-8 -*-
"""第四期部署：上传后端新路由 + 服务 + index.js，重启"""
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
files = [
    'routes/trackStats.js',
    'routes/screenControl.js',
    'routes/publicMeet.js',
    'services/teamScore.js',
    'services/gradeRecord.js',
    'index.js'
]
for f in files:
    sftp.put(os.path.join(BASE_DIR, 'server', f).replace('\\', '/'), f'{REMOTE}/server/{f}')
    print('uploaded', f)
sftp.close()

o, e = run(f'cd {REMOTE}/server && ' + ' && '.join([f'node --check {f}' for f in files]) + ' && echo SYNTAX_OK')
print(o or e)

o, e = run('echo jyj2026 | sudo -S systemctl restart sport-compete-backend && sleep 3 && systemctl is-active sport-compete-backend')
print('service:', o or e)

o, e = run('journalctl -u sport-compete-backend -n 40 --no-pager | tail -30')
print('--- 启动日志 ---')
print(o or e)

o, e = run('curl -s http://127.0.0.1:4100/api/health')
print('health:', o or e)

cli.close()

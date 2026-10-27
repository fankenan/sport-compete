# -*- coding: utf-8 -*-
"""部署：主客场按项目 + 双循环 + 相互战绩 + 大屏公开接口"""
import os
import paramiko

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
HOST, USER, PWD = '10.128.1.45', 'single', 'jyj2026'
REMOTE = '/home/single/sport-compete/server'

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, 22, USER, PWD, timeout=15)


def run(cmd, t=120):
    _, o, e = cli.exec_command(cmd, timeout=t)
    return o.read().decode('utf-8', 'replace').strip(), e.read().decode('utf-8', 'replace').strip()


files = [
    ('server/index.js', f'{REMOTE}/index.js'),
    ('server/routes/screen.js', f'{REMOTE}/routes/screen.js'),
    ('server/routes/schedule.js', f'{REMOTE}/routes/schedule.js'),
    ('server/routes/group.js', f'{REMOTE}/routes/group.js'),
    ('server/services/scheduler.js', f'{REMOTE}/services/scheduler.js'),
    ('server/services/schedule-algorithms.js', f'{REMOTE}/services/schedule-algorithms.js'),
]
sftp = cli.open_sftp()
for local, remote in files:
    sftp.put(os.path.join(BASE_DIR, local), remote)
    print('uploaded:', remote)
sftp.close()

o, e = run(f'for f in index.js routes/screen.js routes/schedule.js routes/group.js services/scheduler.js services/schedule-algorithms.js; do node --check {REMOTE}/$f || echo "FAIL $f"; done; echo SYNTAX_OK')
print('syntax:', o or e)
o, e = run('echo jyj2026 | sudo -S systemctl restart sport-compete-backend && sleep 2 && systemctl is-active sport-compete-backend')
print('service:', o or e)

script = r'''cd /home/single/sport-compete/server
echo "=== 大屏公开接口（不带 token，应可读）==="
curl -s "http://127.0.0.1:4100/api/screen/board?competition_id=6" | head -c 400
echo
echo "=== 项目赛制接口 ==="
curl -s "http://127.0.0.1:4100/api/schedule/event-config?event_item_id=11" -H "Authorization: Bearer $(set -a; . ./.env; set +a; node -e "const jwt=require('jsonwebtoken');console.log(jwt.sign({id:1,username:'admin',role:1,school_id:null,real_name:'t'},process.env.JWT_SECRET,{expiresIn:'10m'}))")"
echo
echo "=== 规模预估 ==="
curl -s "http://127.0.0.1:4100/api/schedule/estimate?competition_id=6&event_item_id=11" -H "Authorization: Bearer $(set -a; . ./.env; set +a; node -e "const jwt=require('jsonwebtoken');console.log(jwt.sign({id:1,username:'admin',role:1,school_id:null,real_name:'t'},process.env.JWT_SECRET,{expiresIn:'10m'}))")"
echo
'''
o, e = run(script, t=90)
print(o or e)
cli.close()

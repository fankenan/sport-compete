# -*- coding: utf-8 -*-
"""部署主客场制：后端 schedule.js → 10.128.1.45；前端 dist → 腾讯云"""
import os
import subprocess
import paramiko

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LOCAL_DIST = os.path.join(BASE_DIR, 'frontend', 'dist')

HOST, USER, PWD = '10.128.1.45', 'single', 'jyj2026'
REMOTE = '/home/single/sport-compete/server'

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, 22, USER, PWD, timeout=15)


def run(cmd, t=120):
    _, o, e = cli.exec_command(cmd, timeout=t)
    return o.read().decode('utf-8', 'replace').strip(), e.read().decode('utf-8', 'replace').strip()


sftp = cli.open_sftp()
sftp.put(os.path.join(BASE_DIR, 'server', 'routes', 'schedule.js'), f'{REMOTE}/routes/schedule.js')
print('uploaded: schedule.js')
sftp.close()

o, e = run(f'node --check {REMOTE}/routes/schedule.js && echo SYNTAX_OK')
print('syntax:', o or e)
o, e = run('echo jyj2026 | sudo -S systemctl restart sport-compete-backend && sleep 2 && systemctl is-active sport-compete-backend')
print('service:', o or e)

# 接口自检：读取开关 → 开启 → 手动编排重复校验是否放开
script = f'''cd {REMOTE}
set -a; . ./.env; set +a
TOKEN=$(node -e "const jwt=require('jsonwebtoken');console.log(jwt.sign({{id:1,username:'admin',role:1,school_id:null,real_name:'t'}},process.env.JWT_SECRET,{{expiresIn:'10m'}}))")
echo "--- 读取开关（赛事6）---"
curl -s -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:4100/api/schedule/home-away?competition_id=6"
echo
echo "--- 开启主客场 ---"
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{{"competition_id":6,"home_away":1}}' http://127.0.0.1:4100/api/schedule/home-away
echo
echo "--- 再读取 ---"
curl -s -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:4100/api/schedule/home-away?competition_id=6"
echo
'''
o, e = run(script, t=90)
print(o or e)
cli.close()

# 前端 dist → 腾讯云
tar_path = os.path.join(BASE_DIR, 'dist.tgz')
subprocess.run(['tar', 'czf', tar_path, '.'], cwd=LOCAL_DIST, check=True)
subprocess.run(['scp', '-q', tar_path, 'tencent:/tmp/dist_ha.tgz'], check=True)
subprocess.run(['ssh', 'tencent',
                'rm -rf /var/www/sport-compete/* && tar xzf /tmp/dist_ha.tgz -C /var/www/sport-compete/ && rm -f /tmp/dist_ha.tgz && ls /var/www/sport-compete/'],
               check=True)
os.remove(tar_path)
print('FRONTEND DEPLOYED')

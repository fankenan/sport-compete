# -*- coding: utf-8 -*-
"""部署：后端 school.js → 10.128.1.45，前端 dist → 腾讯云 /var/www/sport-compete"""
import paramiko, subprocess, os

HOST, USER, PWD = '10.128.1.45', 'single', 'jyj2026'
BASE = '/home/single/sport-compete/server'
ROOT = r'C:/Users/fanke/WorkBuddy/2026-10-16-14-13-47/sport-compete'

# ---------- 1. 后端 ----------
cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, 22, USER, PWD, timeout=15)

def run(cmd, timeout=60):
    _, out, err = cli.exec_command(cmd, timeout=timeout)
    return out.read().decode('utf-8', 'replace').strip(), err.read().decode('utf-8', 'replace').strip()

sftp = cli.open_sftp()
sftp.put(os.path.join(ROOT, 'server/routes/school.js'), f'{BASE}/routes/school.js')
print('uploaded: school.js')
sftp.close()

o, e = run(f'node --check {BASE}/routes/school.js && echo SYNTAX_OK')
print('syntax:', o or e)
o, e = run('echo jyj2026 | sudo -S systemctl restart sport-compete-backend && sleep 2 && systemctl is-active sport-compete-backend')
print('service:', o or e)

# 检查新路由是否注册成功（能命中 401/参数错误而不是 404 说明路由存在）
script = f'''
cd {BASE}
set -a; . ./.env; set +a
TOKEN=$(node -e "const jwt=require('jsonwebtoken');console.log(jwt.sign({{id:1,username:'admin',role:1,school_id:null,real_name:'t'}},process.env.JWT_SECRET,{{expiresIn:'10m'}}))")
echo "--- PUT /school/user/9999 (不存在应返回业务错误而非 404) ---"
curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{{"username":"zzz"}}' http://127.0.0.1:4100/api/school/user/9999
echo
echo "--- DELETE /school/user/9999 ---"
curl -s -X DELETE -H "Authorization: Bearer $TOKEN" http://127.0.0.1:4100/api/school/user/9999
echo
'''
o, e = run(script, timeout=60)
print(o)
if e: print('STDERR:', e[:500])
cli.close()

# ---------- 2. 前端 ----------
subprocess.run('tar czf /tmp/dist.tgz .', cwd=os.path.join(ROOT, 'frontend/dist'), shell=True)
subprocess.run('scp -q /tmp/dist.tgz tencent:/tmp/', shell=True)
r = subprocess.run(
    'ssh tencent "rm -rf /var/www/sport-compete/* && tar xzf /tmp/dist.tgz -C /var/www/sport-compete/ && rm /tmp/dist.tgz && ls /var/www/sport-compete/assets/ | grep -i Schools"',
    shell=True, capture_output=True, text=True)
print('frontend:', r.stdout.strip() or r.stderr.strip())
print('DEPLOY DONE')

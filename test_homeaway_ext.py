# -*- coding: utf-8 -*-
"""从外网 8083 链路实测 POST /api/schedule/event-config，验证 nginx 是否放行 POST"""
import json
import subprocess
import paramiko

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect('10.128.1.45', 22, 'single', 'jyj2026', timeout=15)


def run(cmd, t=120):
    _, o, e = cli.exec_command(cmd, timeout=t)
    return o.read().decode('utf-8', 'replace').strip() or e.read().decode('utf-8', 'replace').strip()


tok = run("""cd /home/single/sport-compete/server && set -a && . ./.env && set +a && node -e "
const j=require('jsonwebtoken');
console.log(j.sign({id:1,username:'admin',role:1,real_name:'管理员'}, process.env.JWT_SECRET, {expiresIn:'2h'}));
" """)
TOKEN = tok.strip().split('\n')[-1]

EID = 16
body = json.dumps({'event_item_id': EID, 'home_away': 1})

# 1) 外网链路 GET
p = subprocess.run(
    ['curl', '-s', '-m', '20', '-H', f'Authorization: Bearer {TOKEN}',
     f'http://150.158.39.237:8083/api/schedule/event-config?event_item_id={EID}'],
    capture_output=True, text=True, encoding='utf-8', errors='replace')
print('外网 GET :', p.stdout[:200] or p.stderr[:200])

# 2) 外网链路 POST
p = subprocess.run(
    ['curl', '-s', '-m', '20', '-X', 'POST',
     '-H', f'Authorization: Bearer {TOKEN}', '-H', 'Content-Type: application/json',
     '-d', body, 'http://150.158.39.237:8083/api/schedule/event-config'],
    capture_output=True, text=True, encoding='utf-8', errors='replace')
print('外网 POST:', p.stdout[:300] or p.stderr[:300])

# 3) 回读
def mq(s):
    return run(f"""mysql -ucompete -p'Compete@2026' sport_compete -N -e "{s}" 2>&1 | grep -v Warning""").replace('\t', '|')

print('DB 后   :', mq(f'SELECT id,name,home_away FROM event_item WHERE id={EID}'))

# 还原
p = subprocess.run(
    ['curl', '-s', '-m', '20', '-X', 'POST',
     '-H', f'Authorization: Bearer {TOKEN}', '-H', 'Content-Type: application/json',
     '-d', json.dumps({'event_item_id': EID, 'home_away': 0}),
     'http://150.158.39.237:8083/api/schedule/event-config'],
    capture_output=True, text=True, encoding='utf-8', errors='replace')
print('外网还原:', p.stdout[:200] or p.stderr[:200])
print('DB 还原 :', mq(f'SELECT id,name,home_away FROM event_item WHERE id={EID}'))

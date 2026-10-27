# -*- coding: utf-8 -*-
"""排查主客场开关回弹：后端读写实测"""
import json
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


def api(m, p, b=None):
    if b is None:
        c = f'''curl -s -X {m} -H "Authorization: Bearer {TOKEN}" "http://127.0.0.1:4100{p}"'''
    else:
        js = json.dumps(b, ensure_ascii=False).replace('"', '\\"')
        c = f'''curl -s -X {m} -H "Authorization: Bearer {TOKEN}" -H "Content-Type: application/json" -d "{js}" "http://127.0.0.1:4100{p}"'''
    return run(c)


def mq(s):
    return run(f"""mysql -ucompete -p'Compete@2026' sport_compete -N -e "{s}" 2>&1 | grep -v Warning""").replace('\t', '|')


EID = 16
print('当前项目列表:', mq('SELECT id,name,home_away FROM event_item'))
print()
print('GET :', api('GET', f'/api/schedule/event-config?event_item_id={EID}'))
print('POST=1:', api('POST', '/api/schedule/event-config', {'event_item_id': EID, 'home_away': 1}))
print('GET 后:', api('GET', f'/api/schedule/event-config?event_item_id={EID}'))
print('DB  后:', mq(f'SELECT id,name,home_away FROM event_item WHERE id={EID}'))
print()
print('POST 传布尔 true:', api('POST', '/api/schedule/event-config', {'event_item_id': EID, 'home_away': True}))
print('GET 后:', api('GET', f'/api/schedule/event-config?event_item_id={EID}'))
print()
print('POST=0 还原:', api('POST', '/api/schedule/event-config', {'event_item_id': EID, 'home_away': 0}))
print('DB 还原后:', mq(f'SELECT id,name,home_away FROM event_item WHERE id={EID}'))
print()
print('estimate:', api('GET', f'/api/schedule/estimate?competition_id=1&event_item_id={EID}')[:200])

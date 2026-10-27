# -*- coding: utf-8 -*-
"""第一期：部署田径数据底座后端（模板库 / 评分表 / 全能 / 赛事扩展配置）"""
import os
import paramiko

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
HOST, USER, PWD = '10.128.1.45', 'single', 'jyj2026'
REMOTE = '/home/single/sport-compete/server'

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, 22, USER, PWD, timeout=15)


def run(cmd, t=180):
    _, o, e = cli.exec_command(cmd, timeout=t)
    return o.read().decode('utf-8', 'replace').strip(), e.read().decode('utf-8', 'replace').strip()


files = [
    ('server/index.js', f'{REMOTE}/index.js'),
    ('server/routes/track.js', f'{REMOTE}/routes/track.js'),
    ('server/routes/event.js', f'{REMOTE}/routes/event.js'),
    ('server/services/scoreEngine.js', f'{REMOTE}/services/scoreEngine.js'),
]
sftp = cli.open_sftp()
for local, remote in files:
    sftp.put(os.path.join(BASE_DIR, local), remote)
    print('uploaded:', remote)
sftp.close()

o, e = run('for f in index.js routes/track.js routes/event.js services/scoreEngine.js; '
           f'do node --check {REMOTE}/$f || echo "FAIL $f"; done; echo SYNTAX_OK')
print('syntax:', o or e)

o, e = run('echo jyj2026 | sudo -S systemctl restart sport-compete-backend && sleep 2 && systemctl is-active sport-compete-backend')
print('service:', o or e)

script = r'''cd /home/single/sport-compete/server
export TOKEN=$(set -a; . ./.env; set +a; node -e "const jwt=require('jsonwebtoken');console.log(jwt.sign({id:1,username:'admin',role:1,school_id:0,real_name:'t'},process.env.JWT_SECRET,{expiresIn:'30m'}))")
H="Authorization: Bearer $TOKEN"
B="http://127.0.0.1:4100/api"
CID=$(mysql -ucompete -pCompete@2026 sport_compete -N -e "SELECT id FROM competition ORDER BY id DESC LIMIT 1")
echo "赛事 id = $CID"

echo "=== 1. 项目模板库（径赛）==="
curl -s "$B/track/templates?event_type=TRACK" -H "$H" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('共',j.data.length,'条');console.log(j.data.slice(0,5).map(t=>t.template_name+'('+t.result_entry_type+')').join(' | '))})"

echo "=== 2. 项目模板库（全能父项）==="
curl -s "$B/track/templates?event_type=COMBINED" -H "$H" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j.data.map(t=>t.id+':'+t.template_name).join(' | '))})"

echo "=== 3. 评分公式（男子）==="
curl -s "$B/track/score-tables?gender=M" -H "$H" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('共',j.data.length,'条');console.log(j.data.slice(0,3).map(t=>t.event_key+' A='+t.coefficient_a+' B='+t.coefficient_b+' C='+t.coefficient_c).join(' | '))})"

echo "=== 4. 试算：男子100米 10.50 秒 ==="
SID=$(mysql -ucompete -pCompete@2026 sport_compete -N -e "SELECT id FROM score_table WHERE event_key='100M' AND gender='M' LIMIT 1")
curl -s -X POST "$B/track/score/preview" -H "$H" -H "Content-Type: application/json" -d "{\"score_table_id\":$SID,\"entry_type\":\"TIME\",\"value\":\"10.50\"}"
echo
echo "=== 5. 试算：男子跳高 2.00 米 ==="
SID2=$(mysql -ucompete -pCompete@2026 sport_compete -N -e "SELECT id FROM score_table WHERE event_key='HJ' AND gender='M' LIMIT 1")
curl -s -X POST "$B/track/score/preview" -H "$H" -H "Content-Type: application/json" -d "{\"score_table_id\":$SID2,\"entry_type\":\"HEIGHT\",\"value\":\"2.00\"}"
echo
echo "=== 6. 成绩解析 ==="
curl -s -X POST "$B/track/parse-result" -H "$H" -H "Content-Type: application/json" -d '{"text":"1:23.45","entry_type":"TIME","decimals":2}'
echo
curl -s -X POST "$B/track/parse-result" -H "$H" -H "Content-Type: application/json" -d '{"text":"DNS","entry_type":"TIME"}'
echo
echo "=== 7. 赛事配置读写 ==="
curl -s -X PUT "$B/track/meet-config" -H "$H" -H "Content-Type: application/json" -d "{\"competition_id\":$CID,\"host_unit\":\"登封市教育局\",\"venue\":\"登封市体育中心\",\"straight_lane_count\":8,\"curve_lane_count\":6,\"minimum_rest_minutes\":30,\"track_timing_mode\":\"ELECTRONIC\",\"grade_bonus_flag\":1,\"grade_bonus_value\":5}"
echo
curl -s "$B/track/meet-config?competition_id=$CID" -H "$H" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('uuid=',j.data.uuid,'主办=',j.data.host_unit,'场地=',j.data.venue,'直道=',j.data.straight_lane_count,'弯道=',j.data.curve_lane_count,'计时=',j.data.track_timing_mode,'达级加分=',j.data.grade_bonus_flag,j.data.grade_bonus_value)})"

echo "=== 8. 从模板批量建项目 ==="
curl -s -X POST "$B/track/events/from-template" -H "$H" -H "Content-Type: application/json" -d "{\"competition_id\":$CID,\"template_ids\":[3,4,20]}"
echo
mysql -ucompete -pCompete@2026 sport_compete -e "SELECT id,name,event_type,result_entry_type,event_unit,is_higher_better FROM event_item WHERE competition_id=$CID ORDER BY id DESC LIMIT 6"

echo "=== 9. 新建全能项目（带评分绑定）==="
curl -s -X POST "$B/track/combined" -H "$H" -H "Content-Type: application/json" -d "{\"competition_id\":$CID,\"name\":\"高中男子五项全能\",\"gender\":\"M\",\"children\":[{\"name\":\"五项·跳远\",\"event_type\":\"FIELD\",\"result_entry_type\":\"DISTANCE\",\"event_unit\":\"m\",\"event_key\":\"LJ\"},{\"name\":\"五项·铅球\",\"event_type\":\"FIELD\",\"result_entry_type\":\"DISTANCE\",\"event_unit\":\"m\",\"event_key\":\"SP\"},{\"name\":\"五项·200米\",\"event_type\":\"TRACK\",\"result_entry_type\":\"TIME\",\"event_unit\":\"s\",\"event_key\":\"200M\"},{\"name\":\"五项·跳高\",\"event_type\":\"FIELD\",\"result_entry_type\":\"HEIGHT\",\"event_unit\":\"m\",\"event_key\":\"HJ\"},{\"name\":\"五项·1500米\",\"event_type\":\"TRACK\",\"result_entry_type\":\"TIME\",\"event_unit\":\"s\",\"event_key\":\"1500M\"}]}"
echo
curl -s "$B/track/combined?competition_id=$CID" -H "$H" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);j.data.forEach(p=>{console.log('父:',p.name);p.children.forEach(c=>console.log('  子',c.combined_item_order,c.combined_item_name,'公式A='+c.coefficient_a,'B='+c.coefficient_b,'C='+c.coefficient_c,'单位='+c.input_unit))})})"
'''
o, e = run(script, t=180)
print(o or e)
cli.close()

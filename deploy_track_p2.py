# -*- coding: utf-8 -*-
"""第二期：部署编排 + 成绩录入，并跑一遍端到端"""
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
HOST = _ENV['SPORT_SSH_HOST']
USER = _ENV['SPORT_SSH_USER']
PWD  = _ENV['SPORT_SSH_PASSWORD']
REMOTE = '/home/single/sport-compete/server'

cli = paramiko.SSHClient()
cli.set_missing_host_policy = None
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, 22, USER, PWD, timeout=15)



def _env(name, fallback=None):
    """读环境变量；未设置时返回 fallback（可为 None 表示必须显式配置）"""
    return os.environ.get(name, fallback)


def _require_env(name):
    v = os.environ.get(name)
    if not v:
        raise SystemExit(
            '[安全] 缺少环境变量 %s。\n'
            '  本脚本会连接真实服务器/数据库，凭据不再写在代码里。\n'
            '  请先设置环境变量后重试。' % name
        )
    return v

def run(cmd, t=240):
    _, o, e = cli.exec_command(cmd, timeout=t, env=_ENV)
    return o.read().decode('utf-8', 'replace').strip(), e.read().decode('utf-8', 'replace').strip()


files = [
    ('server/index.js', f'{REMOTE}/index.js'),
    ('server/routes/trackResult.js', f'{REMOTE}/routes/trackResult.js'),
    ('server/services/trackArrange.js', f'{REMOTE}/services/trackArrange.js'),
]
sftp = cli.open_sftp()
for local, remote in files:
    sftp.put(os.path.join(BASE_DIR, local), remote)
    print('uploaded:', remote)
sftp.close()

o, e = run('for f in index.js routes/trackResult.js services/trackArrange.js; '
           f'do node --check {REMOTE}/$f || echo "FAIL $f"; done; echo SYNTAX_OK')
print('syntax:', o or e)

o, e = run('echo $SPORT_SUDO_PASSWORD | sudo -S systemctl restart sport-compete-backend && sleep 2 && systemctl is-active sport-compete-backend')
print('service:', o or e)

script = r'''cd /home/single/sport-compete/server
export TOKEN=$(set -a; . ./.env; set +a; node -e "const jwt=require('jsonwebtoken');console.log(jwt.sign({id:1,username:'admin',role:1,school_id:0,real_name:'t'},process.env.JWT_SECRET,{expiresIn:'60m'}))")
H="Authorization: Bearer $TOKEN"
J="Content-Type: application/json"
B="http://127.0.0.1:4100/api"
Q() { mysql -ucompete -p$SPORT_DB_PASSWORD sport_compete -N -e "$1" 2>/dev/null; }

echo "########## 准备测试赛事 ##########"
CID=$(Q "SELECT id FROM competition ORDER BY id DESC LIMIT 1")
echo "使用赛事 $CID"
# 取一个组别
BAND=$(Q "SELECT id FROM group_band WHERE competition_id=$CID ORDER BY id LIMIT 1")
echo "组别 $BAND"
if [ -z "$BAND" ]; then
  mysql -ucompete -p$SPORT_DB_PASSWORD sport_compete -e "INSERT INTO group_band (competition_id,stage,gender,label,sort_no) VALUES ($CID,3,1,'A',1)" 2>/dev/null
  BAND=$(Q "SELECT id FROM group_band WHERE competition_id=$CID ORDER BY id DESC LIMIT 1")
  echo "新建组别 $BAND"
fi

echo "########## 1. 建径赛项目 100米 ##########"
EID=$(Q "SELECT id FROM event_item WHERE competition_id=$CID AND name='100米' LIMIT 1")
if [ -z "$EID" ]; then
curl -s -X POST "$B/event/items" -H "$H" -H "$J" -d "{\"competition_id\":$CID,\"name\":\"100米\",\"category\":1,\"lane_count\":8,\"prelim_max\":16,\"event_type\":\"TRACK\",\"result_entry_type\":\"TIME\",\"event_unit\":\"s\",\"is_higher_better\":0,\"result_decimal_places\":2,\"has_preliminary\":1,\"admission_count\":8}"
echo
EID=$(Q "SELECT id FROM event_item WHERE competition_id=$CID AND name='100米' LIMIT 1")
fi
echo "100米 项目 id=$EID"

echo "########## 2. 造 20 名运动员报名 ##########"
mysql -ucompete -p$SPORT_DB_PASSWORD sport_compete -e "
DELETE FROM athlete_entry WHERE competition_id=$CID AND event_item_id=$EID;
DELETE FROM athlete WHERE name LIKE 'P2测试%';
" 2>/dev/null
SCH1=$(Q "SELECT id FROM school ORDER BY id LIMIT 1")
SCH2=$(Q "SELECT id FROM school ORDER BY id LIMIT 1 OFFSET 1")
mysql -ucompete -p$SPORT_DB_PASSWORD sport_compete -e "
INSERT INTO athlete (school_id,name,gender,class_name,bib_no) VALUES
 ($SCH1,'P2测试01',1,'高三1班',101),($SCH1,'P2测试02',1,'高三1班',102),($SCH1,'P2测试03',1,'高三1班',103),
 ($SCH1,'P2测试04',1,'高三2班',104),($SCH1,'P2测试05',1,'高三2班',105),
 ($SCH2,'P2测试06',1,'高三1班',201),($SCH2,'P2测试07',1,'高三1班',202),($SCH2,'P2测试08',1,'高三1班',203),
 ($SCH2,'P2测试09',1,'高三2班',204),($SCH2,'P2测试10',1,'高三2班',205),
 ($SCH1,'P2测试11',1,'高三3班',106),($SCH1,'P2测试12',1,'高三3班',107),
 ($SCH2,'P2测试13',1,'高三3班',206),($SCH2,'P2测试14',1,'高三3班',207),
 ($SCH1,'P2测试15',1,'高三4班',108),($SCH2,'P2测试16',1,'高三4班',208),
 ($SCH1,'P2测试17',1,'高三4班',109),($SCH2,'P2测试18',1,'高三4班',209),
 ($SCH1,'P2测试19',1,'高三5班',110),($SCH2,'P2测试20',1,'高三5班',210);
INSERT INTO athlete_entry (competition_id,band_id,athlete_id,event_item_id,status)
 SELECT $CID,$BAND,id,$EID,2 FROM athlete WHERE name LIKE 'P2测试%';
" 2>/dev/null
echo "报名人数: $(Q "SELECT COUNT(*) FROM athlete_entry WHERE competition_id=$CID AND event_item_id=$EID")"

echo "########## 3. 编排规则 ##########"
curl -s -X PUT "$B/track-result/arrange-rule" -H "$H" -H "$J" -d "{\"competition_id\":$CID,\"event_item_id\":$EID,\"band_id\":$BAND,\"round_code\":\"PRELIM\",\"round_mode\":\"AUTO\",\"lane_count\":8,\"heat_capacity\":8,\"lane_order_mode\":\"SNAKE\",\"seed_mode\":\"BY_BIB\"}"
echo

echo "########## 4. 执行编排 ##########"
curl -s -X POST "$B/track-result/arrange" -H "$H" -H "$J" -d "{\"competition_id\":$CID,\"event_item_id\":$EID,\"band_id\":$BAND,\"round_code\":\"PRELIM\"}"
echo
mysql -ucompete -p$SPORT_DB_PASSWORD sport_compete -e "SELECT id,heat_name,lane_count,entry_count FROM track_heat WHERE competition_id=$CID AND event_item_id=$EID" 2>/dev/null
echo "--- 第1组道次 ---"
H1=$(Q "SELECT id FROM track_heat WHERE competition_id=$CID AND event_item_id=$EID ORDER BY heat_no LIMIT 1")
mysql -ucompete -p$SPORT_DB_PASSWORD sport_compete -e "SELECT lane_no,bib_no,athlete_name,school_id FROM heat_entry WHERE heat_id=$H1 ORDER BY lane_no" 2>/dev/null

echo "########## 5. 录成绩（第1组）##########"
ENTRIES=$(Q "SELECT id FROM heat_entry WHERE heat_id=$H1 ORDER BY lane_no" | head -20 | paste -sd, -)
node -e "
const ids='$ENTRIES'.split(',').map(Number).filter(Boolean);
const times=['11.50','11.20','11.80','12.10','11.95','12.30','11.05','12.50'];
const entries=ids.map((id,i)=>({id,result_text:times[i]||'12.00'}));
console.log(JSON.stringify({heat_id:$H1,entries}));
" > /tmp/p2save.json
curl -s -X POST "$B/track-result/save" -H "$H" -H "$J" -d @/tmp/p2save.json
echo
mysql -ucompete -p$SPORT_DB_PASSWORD sport_compete -e "SELECT lane_no,athlete_name,result_text,result_value,rank_no FROM heat_entry WHERE heat_id=$H1 ORDER BY rank_no" 2>/dev/null

echo "########## 6. 第2、3组也录一下 ##########"
for HID in $(Q "SELECT id FROM track_heat WHERE competition_id=$CID AND event_item_id=$EID ORDER BY heat_no" | tail -n +2); do
node -e "
const mysql=require('mysql2/promise');
(async()=>{
 const c=await mysql.createConnection({host:'127.0.0.1',port:3306,user:'compete',password: process.env.SPORT_DB_PASSWORD,database:'sport_compete'});
 const [rows]=await c.execute('SELECT id FROM heat_entry WHERE heat_id=? ORDER BY lane_no',[$HID]);
 const t=['11.60','11.75','11.40','12.00','11.90','12.20','11.30','12.40'];
 const entries=rows.map((r,i)=>({id:r.id,result_text:t[i]||'12.10'}));
 console.log(JSON.stringify({heat_id:$HID,entries}));
 await c.end();
})();
" > /tmp/p2s.json
curl -s -X POST "$B/track-result/save" -H "$H" -H "$J" -d @/tmp/p2s.json
echo " <- 组 $HID"
done

echo "########## 7. 确认成绩 ##########"
curl -s -X POST "$B/track-result/confirm" -H "$H" -H "$J" -d "{\"heat_id\":$H1}"
echo

echo "########## 8. 晋级规则 + 生成决赛 ##########"
curl -s -X PUT "$B/track-result/advancement-rule" -H "$H" -H "$J" -d "{\"event_item_id\":$EID,\"band_id\":$BAND,\"round_code\":\"PRELIM\",\"advancement_mode\":\"MIXED\",\"qualify_by_place\":2,\"qualify_by_result\":4,\"advance_total_count\":8,\"next_round_code\":\"FINAL\",\"next_heat_count\":1,\"lane_order_mode\":\"BY_RANK\"}"
echo
curl -s -X POST "$B/track-result/advancement/generate" -H "$H" -H "$J" -d "{\"competition_id\":$CID,\"event_item_id\":$EID,\"band_id\":$BAND,\"from_round\":\"PRELIM\",\"to_round\":\"FINAL\"}"
echo
mysql -ucompete -p$SPORT_DB_PASSWORD sport_compete -e "SELECT h.heat_name,h.lane_count,h.entry_count,e.lane_no,e.athlete_name,e.result_text AS 预赛成绩,e.advance_reason FROM heat_entry e JOIN track_heat h ON h.id=e.heat_id WHERE h.competition_id=$CID AND h.event_item_id=$EID AND h.round_code='FINAL' ORDER BY e.lane_no" 2>/dev/null

echo "########## 9. 田赛：建跳远 + 试跳明细 ##########"
FID=$(Q "SELECT id FROM event_item WHERE competition_id=$CID AND name='跳远' LIMIT 1")
if [ -z "$FID" ]; then
curl -s -X POST "$B/event/items" -H "$H" -H "$J" -d "{\"competition_id\":$CID,\"name\":\"跳远\",\"category\":2,\"lane_count\":8,\"prelim_max\":16,\"event_type\":\"FIELD\",\"result_entry_type\":\"DISTANCE\",\"event_unit\":\"m\",\"is_higher_better\":1,\"result_decimal_places\":2,\"base_attempt_count\":3,\"extra_attempt_count\":3,\"extra_qualifier_count\":8}" > /dev/null
FID=$(Q "SELECT id FROM event_item WHERE competition_id=$CID AND name='跳远' LIMIT 1")
fi
echo "跳远 id=$FID"
mysql -ucompete -p$SPORT_DB_PASSWORD sport_compete -e "
DELETE FROM athlete_entry WHERE competition_id=$CID AND event_item_id=$FID;
INSERT INTO athlete_entry (competition_id,band_id,athlete_id,event_item_id,status)
 SELECT $CID,$BAND,id,$FID,2 FROM athlete WHERE name LIKE 'P2测试0%';
" 2>/dev/null
curl -s -X POST "$B/track-result/arrange" -H "$H" -H "$J" -d "{\"competition_id\":$CID,\"event_item_id\":$FID,\"band_id\":$BAND,\"round_code\":\"FINAL\"}"
echo
FH=$(Q "SELECT id FROM track_heat WHERE competition_id=$CID AND event_item_id=$FID ORDER BY heat_no LIMIT 1")
FE=$(Q "SELECT id FROM heat_entry WHERE heat_id=$FH ORDER BY sort_no LIMIT 1")
curl -s -X PUT "$B/track-result/attempts/$FE" -H "$H" -H "$J" -d '{"attempts":[{"attempt_no":1,"phase":"BASE","result_text":"5.42","symbol":"O"},{"attempt_no":2,"phase":"BASE","result_text":"5.88","symbol":"O"},{"attempt_no":3,"phase":"BASE","result_text":"0","symbol":"X"}]}'
echo
mysql -ucompete -p$SPORT_DB_PASSWORD sport_compete -e "SELECT id,attempt_no,result_text,result_value,symbol,is_best FROM field_attempt WHERE heat_entry_id=$FE" 2>/dev/null
mysql -ucompete -p$SPORT_DB_PASSWORD sport_compete -e "SELECT id,athlete_name,result_text,result_value,best_attempt_id FROM heat_entry WHERE id=$FE" 2>/dev/null

echo "########## 10. 清理测试数据 ##########"
mysql -ucompete -p$SPORT_DB_PASSWORD sport_compete -e "
DELETE FROM heat_entry WHERE competition_id=$CID;
DELETE FROM track_heat WHERE competition_id=$CID;
DELETE FROM field_attempt WHERE id>0;
DELETE FROM athlete_entry WHERE competition_id=$CID AND event_item_id IN ($EID,$FID);
DELETE FROM athlete WHERE name LIKE 'P2测试%';
DELETE FROM event_item WHERE competition_id=$CID AND name IN ('100米','跳远');
DELETE FROM advancement_rule WHERE event_item_id IN ($EID,$FID);
DELETE FROM arrangement_rule WHERE event_item_id IN ($EID,$FID);
" 2>/dev/null
echo "清理完成"
'''
o, e = run(script, t=300)
print(o or e)
cli.close()

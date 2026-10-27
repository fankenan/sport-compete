# -*- coding: utf-8 -*-
"""
只读探查：径赛分组双轨 —— heat_group/heat_member 与 track_heat/heat_entry 各有多少数据。
只读，不做任何写操作、不改任何数据。
"""
import paramiko

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect('10.128.1.45', 22, 'single', 'jyj2026', timeout=15)


def run(cmd, t=120):
    _, o, e = cli.exec_command(cmd, timeout=t)
    out = o.read().decode('utf-8', 'replace').strip()
    err = e.read().decode('utf-8', 'replace').strip()
    return out or err


print('===== 1. 读数据库配置 =====')
env = run('cat /home/single/sport-compete/server/.env 2>/dev/null | grep -iE "^(DB_|MYSQL_)" | sed "s/PASSWORD=.*/PASSWORD=***/"')
print(env or '(读不到 .env，尝试 db.js)')
if not env:
    print(run('grep -iE "host|user|password|database" /home/single/sport-compete/server/db.js | head -20'))

print('\n===== 2. 找 mysql 凭据 =====')
cred = run('cat /home/single/sport-compete/server/.env 2>/dev/null | grep -iE "^(DB_PASSWORD|MYSQL_PASSWORD|DB_USER|MYSQL_USER|DB_NAME|MYSQL_DATABASE|DB_HOST)"')
print(cred.replace('\n', ' | ') if cred else '(无)')

# 直接从 .env 拼一条 mysql 命令
mysql_cmd = (
    'cd /home/single/sport-compete/server && '
    'set -a && . ./.env 2>/dev/null; set +a; '
    'MYSQL_CMD="mysql -u${DB_USER:-root} -p${DB_PASSWORD} -h${DB_HOST:-127.0.0.1} ${DB_NAME:-sport_compete} -N -B"; '
    'echo "--- 库名 ---"; echo "${DB_NAME:-sport_compete}"; '
    'echo "--- 表行数 ---"; '
    '$MYSQL_CMD -e "'
    'SELECT \'heat_group\', COUNT(*) FROM heat_group UNION ALL '
    'SELECT \'heat_member\', COUNT(*) FROM heat_member UNION ALL '
    'SELECT \'track_heat\', COUNT(*) FROM track_heat UNION ALL '
    'SELECT \'heat_entry\', COUNT(*) FROM heat_entry UNION ALL '
    'SELECT \'competition\', COUNT(*) FROM competition UNION ALL '
    'SELECT \'event_item\', COUNT(*) FROM event_item;'
    '" 2>&1 | tail -20'
)
print('\n===== 3. 四张表行数 =====')
print(run(mysql_cmd))

print('\n===== 4. heat_group 明细（若有，看落在哪些赛事/项目） =====')
print(run(
    'cd /home/single/sport-compete/server && set -a && . ./.env 2>/dev/null; set +a; '
    'mysql -u${DB_USER:-root} -p${DB_PASSWORD} -h${DB_HOST:-127.0.0.1} ${DB_NAME:-sport_compete} -N -B -e '
    '"SELECT hg.competition_id, c.name, hg.event_item_id, ei.name, COUNT(*) '
    ' FROM heat_group hg LEFT JOIN competition c ON c.id=hg.competition_id '
    ' LEFT JOIN event_item ei ON ei.id=hg.event_item_id '
    ' GROUP BY hg.competition_id, hg.event_item_id ORDER BY 1;" 2>&1 | tail -20'
))

print('\n===== 5. track_heat 明细（若有，看落在哪些赛事/项目） =====')
print(run(
    'cd /home/single/sport-compete/server && set -a && . ./.env 2>/dev/null; set +a; '
    'mysql -u${DB_USER:-root} -p${DB_PASSWORD} -h${DB_HOST:-127.0.0.1} ${DB_NAME:-sport_compete} -N -B -e '
    '"SELECT th.competition_id, c.name, th.event_item_id, ei.name, COUNT(*) '
    ' FROM track_heat th LEFT JOIN competition c ON c.id=th.competition_id '
    ' LEFT JOIN event_item ei ON ei.id=th.event_item_id '
    ' GROUP BY th.competition_id, th.event_item_id ORDER BY 1;" 2>&1 | tail -25'
))

print('\n===== 6. 赛事清单 =====')
print(run(
    'cd /home/single/sport-compete/server && set -a && . ./.env 2>/dev/null; set +a; '
    'mysql -u${DB_USER:-root} -p${DB_PASSWORD} -h${DB_HOST:-127.0.0.1} ${DB_NAME:-sport_compete} -N -B -e '
    '"SELECT id, name, stage FROM competition ORDER BY id;" 2>&1 | tail -20'
))

cli.close()
print('\n===== 探查结束（全程只读） =====')

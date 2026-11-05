# -*- coding: utf-8 -*-
"""
清理线上孤儿/脏数据（先备份，事务删除，删后验证）

清理清单：
  1. heat_member 4 条 + heat_group 1 条  —— 田径分组误用在篮球项目上，无 match_info 引用
  2. team_entry 1 条 (id=45)              —— 属赛事 26（已不存在）
  3. event_item 4 条 (76-79)              —— 属赛事 25/26/27/28（均已不存在），名为「测试篮球」

备份：mysqldump 全表导出这 4 张表 → 服务器 /home/single/db_backup_*.sql 并下载到本地
"""
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


BASE = os.path.dirname(os.path.abspath(__file__))
cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(_ENV['SPORT_SSH_HOST'], 22, _ENV['SPORT_SSH_USER'], _ENV['SPORT_SSH_PASSWORD'], timeout=20)

ENV = 'cd /home/single/sport-compete/server && set -a && . ./.env 2>/dev/null; set +a;'


def run(cmd, t=300):
    _, o, e = cli.exec_command(cmd, timeout=t, env=_ENV)
    return o.read().decode('utf-8', 'replace').strip() or e.read().decode('utf-8', 'replace').strip()


def q(sql):
    return run(f'{ENV} mysql -u$DB_USER -p$DB_PASSWORD -h$DB_HOST $DB_NAME -N -B -e "{sql}" 2>&1 | grep -v Warning')


def qf(sql):
    """执行写操作，返回受影响信息"""
    return run(f'{ENV} mysql -u$DB_USER -p$DB_PASSWORD -h$DB_HOST $DB_NAME -e "{sql}" 2>&1 | grep -v Warning')


STAMP = '20261027_cleanup'
TABLES = ['heat_group', 'heat_member', 'event_item', 'team_entry']

print('===== 1. 备份（mysqldump 全表）=====')
dump = ' '.join(TABLES)
cmd = (f'{ENV} mysqldump -u$DB_USER -p$DB_PASSWORD -h$DB_HOST '
       f'--single-transaction --skip-lock-tables $DB_NAME {dump} '
       f'> /home/single/db_backup_{STAMP}.sql 2>/dev/null; '
       f'ls -lh /home/single/db_backup_{STAMP}.sql | awk "{{print \\$5}}"; '
       f'grep -c "INSERT INTO" /home/single/db_backup_{STAMP}.sql')
print('  备份大小/INSERT行数:', run(cmd))

sftp = cli.open_sftp()
local_bak = os.path.join(BASE, f'db_backup_{STAMP}.sql')
sftp.get(f'/home/single/db_backup_{STAMP}.sql', local_bak)
sftp.close()
print('  已下载到本地:', local_bak, f'({os.path.getsize(local_bak)/1024:.0f} KB)')

print('\n===== 2. 删除前快照 =====')
print('  heat_group:', q('SELECT COUNT(*) FROM heat_group'))
print('  heat_member:', q('SELECT COUNT(*) FROM heat_member'))
print('  event_item:', q('SELECT COUNT(*) FROM event_item'))
print('  team_entry:', q('SELECT COUNT(*) FROM team_entry'))

print('\n===== 3. 事务删除 =====')
sql = (
    'START TRANSACTION; '
    'DELETE FROM heat_member WHERE heat_group_id=14; '
    'DELETE FROM heat_group WHERE id=14 AND event_item_id=11; '
    'DELETE FROM team_entry WHERE id=45 AND competition_id NOT IN (SELECT id FROM competition); '
    'DELETE FROM event_item WHERE id IN (76,77,78,79) '
    '  AND competition_id NOT IN (SELECT id FROM (SELECT id FROM competition) t); '
    'COMMIT;'
)
print(qf(sql))

print('\n===== 4. 删除后验证 =====')
print('  heat_group:', q('SELECT COUNT(*) FROM heat_group'), '(应为 0)')
print('  heat_member:', q('SELECT COUNT(*) FROM heat_member'), '(应为 0)')
print('  event_item:', q('SELECT COUNT(*) FROM event_item'), '(应为 7)')
print('  team_entry:', q('SELECT COUNT(*) FROM team_entry'), '(应为 12)')

print('\n===== 5. 孤儿复查（应全空）=====')
print('  孤儿 event_item:',
      q('SELECT COUNT(*) FROM event_item ei LEFT JOIN competition c ON c.id=ei.competition_id WHERE c.id IS NULL'))
print('  孤儿 team_entry:',
      q('SELECT COUNT(*) FROM team_entry te LEFT JOIN competition c ON c.id=te.competition_id WHERE c.id IS NULL'))
print('  孤儿 heat_member:',
      q('SELECT COUNT(*) FROM heat_member hm LEFT JOIN heat_group hg ON hg.id=hm.heat_group_id WHERE hg.id IS NULL'))

print('\n===== 6. 现存赛事与项目（确认正常数据未受影响）=====')
print(q('SELECT c.id, c.name, COUNT(ei.id) FROM competition c '
        'LEFT JOIN event_item ei ON ei.competition_id=c.id GROUP BY c.id ORDER BY c.id'))
print('\n  赛事6 的队伍数:',
      q('SELECT COUNT(*) FROM team_entry WHERE competition_id=6'), '(应仍为 12)')

cli.close()
print('\n===== 完成 =====')
print(f'备份文件：服务器 /home/single/db_backup_{STAMP}.sql ；本地 {local_bak}')

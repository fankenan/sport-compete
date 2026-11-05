# -*- coding: utf-8 -*-
"""第三期实测前置探查：找一个有编排数据的赛事"""
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


cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(_ENV['SPORT_SSH_HOST'], 22, _ENV['SPORT_SSH_USER'], _ENV['SPORT_SSH_PASSWORD'], timeout=15)


def run(cmd, t=120):
    _, o, e = cli.exec_command(cmd, timeout=t, env=_ENV)
    return o.read().decode('utf-8', 'replace').strip(), e.read().decode('utf-8', 'replace').strip()


o, e = run("mysql -ucompete -pprocess.env.SPORT_DB_PASSWORD sport_compete -e \"SELECT id,name FROM competition ORDER BY id DESC LIMIT 5\" 2>&1")
print('== 赛事 ==')
print(o or e)

o, e = run("mysql -ucompete -pprocess.env.SPORT_DB_PASSWORD sport_compete -e \"SELECT h.id,h.competition_id,h.band_id,h.event_item_id,h.heat_no,h.lane_count,h.entry_count, e.name AS event_name FROM track_heat h LEFT JOIN event_item e ON e.id=h.event_item_id ORDER BY h.id DESC LIMIT 10\" 2>&1")
print('== 分组 ==')
print(o or e)

o, e = run("mysql -ucompete -pprocess.env.SPORT_DB_PASSWORD sport_compete -e \"SELECT COUNT(*) AS c FROM heat_entry\" 2>&1")
print('== 组内人数 ==')
print(o or e)

o, e = run("mysql -ucompete -pprocess.env.SPORT_DB_PASSWORD sport_compete -e \"SELECT COUNT(*) AS c FROM athlete_entry WHERE status=2\" 2>&1")
print('== 已通过报名 ==')
print(o or e)

o, e = run("mysql -ucompete -pprocess.env.SPORT_DB_PASSWORD sport_compete -e \"SELECT id,name FROM event_item ORDER BY id LIMIT 10\" 2>&1")
print('== 项目 ==')
print(o or e)

o, e = run("mysql -ucompete -pprocess.env.SPORT_DB_PASSWORD sport_compete -e \"SELECT id,label FROM group_band ORDER BY id LIMIT 10\" 2>&1")
print('== 组别 ==')
print(o or e)

o, e = run("mysql -ucompete -pprocess.env.SPORT_DB_PASSWORD sport_compete -e \"SELECT id,name FROM school ORDER BY id LIMIT 6\" 2>&1")
print('== 学校 ==')
print(o or e)

o, e = run("mysql -ucompete -pprocess.env.SPORT_DB_PASSWORD sport_compete -e \"SELECT id,name,school_id FROM athlete ORDER BY id LIMIT 8\" 2>&1")
print('== 运动员 ==')
print(o or e)

cli.close()

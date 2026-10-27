# -*- coding: utf-8 -*-
"""第三期实测前置探查：找一个有编排数据的赛事"""
import os
import paramiko

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect('10.128.1.45', 22, 'single', 'jyj2026', timeout=15)


def run(cmd, t=120):
    _, o, e = cli.exec_command(cmd, timeout=t)
    return o.read().decode('utf-8', 'replace').strip(), e.read().decode('utf-8', 'replace').strip()


o, e = run("mysql -ucompete -p'Compete@2026' sport_compete -e \"SELECT id,name FROM competition ORDER BY id DESC LIMIT 5\" 2>&1")
print('== 赛事 ==')
print(o or e)

o, e = run("mysql -ucompete -p'Compete@2026' sport_compete -e \"SELECT h.id,h.competition_id,h.band_id,h.event_item_id,h.heat_no,h.lane_count,h.entry_count, e.name AS event_name FROM track_heat h LEFT JOIN event_item e ON e.id=h.event_item_id ORDER BY h.id DESC LIMIT 10\" 2>&1")
print('== 分组 ==')
print(o or e)

o, e = run("mysql -ucompete -p'Compete@2026' sport_compete -e \"SELECT COUNT(*) AS c FROM heat_entry\" 2>&1")
print('== 组内人数 ==')
print(o or e)

o, e = run("mysql -ucompete -p'Compete@2026' sport_compete -e \"SELECT COUNT(*) AS c FROM athlete_entry WHERE status=2\" 2>&1")
print('== 已通过报名 ==')
print(o or e)

o, e = run("mysql -ucompete -p'Compete@2026' sport_compete -e \"SELECT id,name FROM event_item ORDER BY id LIMIT 10\" 2>&1")
print('== 项目 ==')
print(o or e)

o, e = run("mysql -ucompete -p'Compete@2026' sport_compete -e \"SELECT id,label FROM group_band ORDER BY id LIMIT 10\" 2>&1")
print('== 组别 ==')
print(o or e)

o, e = run("mysql -ucompete -p'Compete@2026' sport_compete -e \"SELECT id,name FROM school ORDER BY id LIMIT 6\" 2>&1")
print('== 学校 ==')
print(o or e)

o, e = run("mysql -ucompete -p'Compete@2026' sport_compete -e \"SELECT id,name,school_id FROM athlete ORDER BY id LIMIT 8\" 2>&1")
print('== 运动员 ==')
print(o or e)

cli.close()

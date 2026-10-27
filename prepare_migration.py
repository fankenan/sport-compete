# -*- coding: utf-8 -*-
"""把 sport-compete 全套源码 + 文档 + 记忆整理到迁移目标目录
排除：node_modules / dist / .git / 日志 / SSH私钥等敏感文件
"""
import fnmatch
import os
import shutil

SRC = r'C:\Users\fanke\WorkBuddy\2026-10-16-14-13-47'
DST = r'C:\Users\fanke\WorkBuddy\校园体育竞赛管理系统'

EXCLUDE_DIRS = {'node_modules', 'dist', '.git', '.venv', 'logs', '__pycache__', 'secrets', '.workbuddy-sqlite'}
EXCLUDE_FILE_PAT = [
    '*.log', 'dist_old*', 'id_ed25519*', 'id_rsa*', '*.pem', '*.key',
    '.env', '*.sqlite', '*.tar.gz', '*.zip'
]

copied, skipped = 0, []


def excluded(name, is_dir):
    if is_dir:
        if name in EXCLUDE_DIRS:
            return True
        if name.startswith('dist_old'):
            return True
        return False
    return any(fnmatch.fnmatch(name, p) for p in EXCLUDE_FILE_PAT)


def copy_tree(local_src, rel_dst):
    global copied
    target = os.path.join(DST, rel_dst)
    os.makedirs(target, exist_ok=True)
    for name in os.listdir(local_src):
        lp = os.path.join(local_src, name)
        is_dir = os.path.isdir(lp)
        if excluded(name, is_dir):
            skipped.append(os.path.relpath(lp, SRC))
            continue
        rp = os.path.join(target, name)
        if is_dir:
            copy_tree(lp, os.path.join(rel_dst, name))
        else:
            shutil.copy2(lp, rp)
            copied += 1


# 1) 源码
copy_tree(os.path.join(SRC, 'sport-compete'), 'sport-compete')

# 2) 文档与参考资料
os.makedirs(os.path.join(DST, 'docs'), exist_ok=True)
doc_files = [
    '体育竞赛管理系统_设计文档_v2.md',
    '体育竞赛管理系统_实施设计_v3.md',
    '体育竞赛管理系统_使用说明.md',
    '体育老师云_田径系统_对标分析.md',
    '前端廉价感诊断报告.md',
    '秩序册范本分析报告.md',
    '秩序册_全文.txt',
]
REF_FILES = ['apidocs.json', 'routers.json', 'meets.json', 'app.js',
             'schedule-algorithms.js', 'track-algorithms.js',
             'tyls_api_list.txt', 'tyls_api_tyxt.txt', 'tyls_index.html',
             'tyls_schemas.txt', 'tyls_urls.txt']

for f in doc_files:
    p = os.path.join(SRC, f)
    if os.path.isfile(p):
        shutil.copy2(p, os.path.join(DST, 'docs', f))
        copied += 1
    else:
        skipped.append(f + '（源目录无此文件）')

os.makedirs(os.path.join(DST, 'docs', '参考资料'), exist_ok=True)
for f in REF_FILES:
    p = os.path.join(SRC, f)
    if os.path.isfile(p):
        shutil.copy2(p, os.path.join(DST, 'docs', '参考资料', f))
        copied += 1

# 秩序册样本目录
src_pm = os.path.join(SRC, '秩序册样本')
if os.path.isdir(src_pm):
    copy_tree(src_pm, os.path.join('docs', '秩序册样本'))
# 抓取的参考资源
for d in ['tyls_chunks']:
    pd = os.path.join(SRC, d)
    if os.path.isdir(pd):
        copy_tree(pd, os.path.join('docs', '参考资料', d))

# 3) 项目记忆（只取本系统的工作日志与长期约定）
os.makedirs(os.path.join(DST, '项目记忆'), exist_ok=True)
mem_src = os.path.join(SRC, '.workbuddy', 'memory')
if os.path.isdir(mem_src):
    for name in sorted(os.listdir(mem_src)):
        p = os.path.join(mem_src, name)
        if os.path.isfile(p):
            shutil.copy2(p, os.path.join(DST, '项目记忆', name))
            copied += 1

print('复制文件数:', copied)
print('跳过（依赖/构建产物/敏感文件）共', len(skipped), '项，举例如:', skipped[:8])

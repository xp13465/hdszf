#!/usr/bin/env python3
"""生成 OG 预览图 1200×630，用于微信/微博/Twitter 分享卡片"""

from PIL import Image, ImageDraw, ImageFont
import os

W, H = 1200, 630
OUTPUT = os.path.join(os.path.dirname(__file__), '..', 'images', 'og-preview.png')

# 字体路径
FONT_BOLD = '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'
FONT_REGULAR = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
# 备选：NotoSerif
FONT_SERIF = '/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc'

# 颜色
DARK_BLUE = (26, 53, 85)       # #1a3555
ACCENT_GOLD = (184, 134, 11)   # #b8860b
WHITE = (255, 255, 255)
RED = (197, 48, 48)
GREEN = (26, 125, 58)
LIGHT_BG = (240, 242, 245)
CARD_BG = (255, 255, 255)
TEXT_MUTED = (153, 153, 153)

img = Image.new('RGB', (W, H), DARK_BLUE)
draw = ImageDraw.Draw(img)

def font_bold(size):
    return ImageFont.truetype(FONT_BOLD, size)

def font_regular(size):
    return ImageFont.truetype(FONT_REGULAR, size)

def font_serif(size):
    return ImageFont.truetype(FONT_SERIF, size)

# ── 顶部装饰线 ──
draw.rectangle([0, 0, W, 4], fill=ACCENT_GOLD)

# ── 左侧文字区 ──
left_x = 70
y = 60

# 标题
draw.text((left_x, y), '恒市值法', fill=WHITE, font=font_bold(56))
y += 68
draw.text((left_x, y), '智能资产配置', fill=WHITE, font=font_bold(52))
y += 60

# 副标题
draw.text((left_x, y), '不盯盘 · 不择时 · 每月5分钟 · 50万变111万', 
          fill=(200, 210, 225), font=font_regular(20))
y += 50

# 核心数据三个指标
metrics = [
    ('年化收益', '7.60%', RED),
    ('最大回撤', '-6.09%', GREEN),
    ('月胜率', '67.9%', RED),
]

card_w, card_h = 160, 80
card_gap = 20
total_w = len(metrics) * card_w + (len(metrics) - 1) * card_gap
start_x = left_x

for i, (label, value, color) in enumerate(metrics):
    cx = start_x + i * (card_w + card_gap)
    cy = y
    # 卡片背景
    draw.rounded_rectangle([cx, cy, cx + card_w, cy + card_h], radius=10, fill=CARD_BG)
    # 标签
    draw.text((cx + card_w//2, cy + 16), label, fill=TEXT_MUTED, font=font_regular(15), anchor='mt')
    # 数值
    draw.text((cx + card_w//2, cy + 50), value, fill=color, font=font_bold(30), anchor='mt')

y += card_h + 35

# 亮点列表
highlights = [
    ('回测周期', '11年 (2015-2026)'),
    ('数据来源', '35,000+条基金净值记录'),
    ('覆盖资产', 'A股 · 美股 · 黄金 · 现金'),
    ('推荐配置', '稳健型：年化7.6% 回撤6.1%'),
]

col_gap = 350
for i, (label, value) in enumerate(highlights):
    col = i % 2
    row = i // 2
    hx = left_x + col * col_gap
    hy = y + row * 55
    draw.text((hx, hy), label, fill=(180, 195, 215), font=font_regular(16))
    draw.text((hx, hy + 24), value, fill=WHITE, font=font_bold(20))

y = hy + 80

# CTA 按钮
btn_x, btn_y, btn_w, btn_h = left_x, y, 340, 52
draw.rounded_rectangle([btn_x, btn_y, btn_x + btn_w, btn_y + btn_h], radius=26, fill=ACCENT_GOLD)
draw.text((btn_x + btn_w//2, btn_y + btn_h//2), '免费在线回测你的配置 →', 
          fill=WHITE, font=font_bold(19), anchor='mm')

# URL
draw.text((btn_x + btn_w + 20, btn_y + btn_h//2), 
          'hdszftools-ujpzw01zm.maozi.io',
          fill=(150, 170, 200), font=font_regular(15), anchor='lm')

# ── 右侧装饰：模拟一个小图表 ──
chart_x = 780
chart_y = 100
chart_w, chart_h = 340, 320

# 图表背景
draw.rounded_rectangle([chart_x, chart_y, chart_x + chart_w, chart_y + chart_h], 
                        radius=16, fill=(30, 65, 100))

# 标题
draw.text((chart_x + chart_w//2, chart_y + 25), '累计收益曲线', 
          fill=(200, 210, 225), font=font_regular(15), anchor='mt')

# 模拟上升曲线（简化折线）
import math
points = []
for t in range(131):
    x = chart_x + 40 + t * (chart_w - 80) / 130
    # 模拟一个从0到122%的增长曲线，带一些波动
    progress = t / 130
    base = progress * 122
    noise = math.sin(t * 0.3) * 8 + math.sin(t * 0.1) * 15
    val = base + noise
    y_val = chart_y + chart_h - 50 - (val / 150) * (chart_h - 80)
    points.append((x, y_val))

# 填充区域
from PIL import ImageDraw as ID
poly_points = points + [(points[-1][0], chart_y + chart_h - 50), (points[0][0], chart_y + chart_h - 50)]
# 简化：只用线
for i in range(len(points) - 1):
    draw.line([points[i], points[i+1]], fill=(197, 48, 48), width=3)

# 终点标注
end_x, end_y = points[-1]
draw.ellipse([end_x - 5, end_y - 5, end_x + 5, end_y + 5], fill=RED)
draw.text((end_x + 12, end_y - 10), '+122.4%', fill=RED, font=font_bold(16))

# 0% 基准线
zero_y = chart_y + chart_h - 50
draw.line([chart_x + 30, zero_y, chart_x + chart_w - 20, zero_y], 
          fill=(100, 120, 150), width=1)

# ── 底部 ──
# 品牌信息
draw.text((W//2, H - 55), 'hdszf · 恒市值法智能理财助手 · hdszftools', 
          fill=(130, 150, 180), font=font_regular(16), anchor='mt')

# 免责
draw.text((W//2, H - 28), '历史回测不代表未来表现 · 投资有风险 入市需谨慎', 
          fill=(100, 120, 150), font=font_regular(13), anchor='mt')

# 底部装饰线
draw.rectangle([0, H - 3, W, H], fill=ACCENT_GOLD)

# 保存
os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
img.save(OUTPUT, 'PNG')
print(f'OG preview image saved to: {OUTPUT}')
print(f'Size: {W}×{H}')

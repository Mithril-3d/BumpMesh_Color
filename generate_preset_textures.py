import math
from PIL import Image, ImageDraw

SIZE = 512
THUMB_SIZE = 80

def save_texture_and_thumb(img, base_name):
    full_path = f"textures/{base_name}.png"
    thumb_path = f"textures/thumbs/{base_name}.webp"
    img.save(full_path, "PNG")
    thumb = img.resize((THUMB_SIZE, THUMB_SIZE), Image.Resampling.LANCZOS)
    thumb.save(thumb_path, "WEBP", quality=90)
    print(f"Generated: {full_path} & {thumb_path}")

# ─────────────────────────────────────────────────────────────────────────────
# 和風パターンスイート
# ─────────────────────────────────────────────────────────────────────────────

# 1. 和風・市松模様 (Ichimatsu Checkers) - 2色
def gen_ichimatsu():
    img = Image.new("RGB", (SIZE, SIZE))
    draw = ImageDraw.Draw(img)
    c1 = (27, 53, 88)     # 藍色
    c2 = (244, 244, 242)  # 白練
    tile = SIZE // 8
    for y in range(8):
        for x in range(8):
            color = c1 if (x + y) % 2 == 0 else c2
            draw.rectangle([x * tile, y * tile, (x + 1) * tile, (y + 1) * tile], fill=color)
    return img

# 2. 和風・青海波 (Seigaiha Waves) - 2色
def gen_seigaiha():
    img = Image.new("RGB", (SIZE, SIZE), (247, 243, 232)) # 象牙色
    draw = ImageDraw.Draw(img)
    c_blue = (30, 75, 122) # 紺碧
    c_bg = (247, 243, 232)
    step_x = 64
    step_y = 32
    rings = 4
    max_r = 50
    # 複数行を描画
    for row in range(-2, SIZE // step_y + 4):
        y_center = row * step_y
        offset_x = (row % 2) * (step_x // 2)
        for col in range(-2, SIZE // step_x + 4):
            x_center = col * step_x + offset_x
            for r_idx in range(rings, 0, -1):
                r = int(max_r * (r_idx / rings))
                # 上半分円弧
                draw.chord([x_center - r, y_center - r, x_center + r, y_center + r], 
                           start=180, end=360, fill=c_blue if r_idx % 2 == 1 else c_bg, outline=c_blue, width=2)
    return img

# 3. 和風・矢絣 (Yagasuri Arrows) - 2色
def gen_yagasuri():
    img = Image.new("RGB", (SIZE, SIZE), (236, 230, 216)) # 生成
    draw = ImageDraw.Draw(img)
    c_red = (199, 55, 47)  # 紅緋
    col_w = 64
    row_h = 64
    for cx in range(0, SIZE, col_w):
        is_even_col = (cx // col_w) % 2 == 0
        for cy in range(0, SIZE, row_h):
            # 矢羽根の左右
            mid_x = cx + col_w // 2
            if is_even_col:
                pts_left = [(cx, cy), (mid_x, cy + row_h // 2), (mid_x, cy + row_h), (cx, cy + row_h // 2)]
                pts_right = [(cx + col_w, cy), (mid_x, cy + row_h // 2), (mid_x, cy + row_h), (cx + col_w, cy + row_h // 2)]
            else:
                pts_left = [(cx, cy + row_h), (mid_x, cy + row_h // 2), (mid_x, cy), (cx, cy + row_h // 2)]
                pts_right = [(cx + col_w, cy + row_h), (mid_x, cy + row_h // 2), (mid_x, cy), (cx + col_w, cy + row_h // 2)]
            draw.polygon(pts_left, fill=c_red)
            draw.polygon(pts_right, fill=c_red)
    return img

# 4. 和風・麻の葉 (Asanoha) - 3色
def gen_asanoha():
    img = Image.new("RGB", (SIZE, SIZE))
    draw = ImageDraw.Draw(img)
    c1 = (90, 61, 92)    # 古代紫
    c2 = (164, 158, 122) # 枯草色
    c3 = (240, 237, 229) # 生成り
    cell = 64
    for y in range(0, SIZE, cell):
        for x in range(0, SIZE, cell):
            mx, my = x + cell // 2, y + cell // 2
            draw.polygon([(x, y), (mx, y), (mx, my)], fill=c1)
            draw.polygon([(mx, y), (x + cell, y), (mx, my)], fill=c2)
            draw.polygon([(x + cell, y), (x + cell, my), (mx, my)], fill=c3)
            draw.polygon([(x + cell, my), (x + cell, y + cell), (mx, my)], fill=c1)
            draw.polygon([(x + cell, y + cell), (mx, y + cell), (mx, my)], fill=c2)
            draw.polygon([(mx, y + cell), (x, y + cell), (mx, my)], fill=c3)
            draw.polygon([(x, y + cell), (x, my), (mx, my)], fill=c1)
            draw.polygon([(x, my), (x, y), (mx, my)], fill=c2)
    return img

# 5. 和風・三つ巴 (Tomoe Triad) - 3色
def gen_tomoe():
    img = Image.new("RGB", (SIZE, SIZE))
    draw = ImageDraw.Draw(img)
    c1 = (34, 34, 34)    # 漆黒
    c2 = (195, 39, 43)   # 朱赤
    c3 = (200, 153, 50)  # 金茶
    colors = [c1, c2, c3]
    step = 64
    for y in range(0, SIZE, step):
        for x in range(0, SIZE, step):
            idx = ((x // step) + (y // step) * 2) % 3
            draw.rectangle([x, y, x + step, y + step], fill=colors[idx])
            # 三角スライスカット
            draw.polygon([(x, y), (x + step, y), (x + step // 2, y + step // 2)], fill=colors[(idx + 1) % 3])
            draw.polygon([(x, y + step), (x + step, y + step), (x + step // 2, y + step // 2)], fill=colors[(idx + 2) % 3])
    return img

# 6. 和風・亀甲花菱 (Kikko Hexagon) - 4色
def gen_kikko():
    img = Image.new("RGB", (SIZE, SIZE))
    draw = ImageDraw.Draw(img)
    c1 = (35, 71, 52)    # 深緑
    c2 = (143, 46, 20)   # 弁柄
    c3 = (229, 163, 35)  # 山吹
    c4 = (235, 228, 232) # 白藤
    colors = [c1, c2, c3, c4]
    step = 64
    for y in range(0, SIZE, step):
        for x in range(0, SIZE, step):
            idx = ((x // step) + (y // step)) % 4
            draw.rectangle([x, y, x + step, y + step], fill=colors[idx])
            mx, my = x + step // 2, y + step // 2
            draw.polygon([(mx, y), (x + step, my), (mx, y + step), (x, my)], fill=colors[(idx + 2) % 4])
            draw.rectangle([mx - step // 4, my - step // 4, mx + step // 4, my + step // 4], fill=colors[(idx + 1) % 4])
    return img

# 7. 和風・籠目錦 (Kagome 8-Color) - 8色
def gen_kagome():
    img = Image.new("RGB", (SIZE, SIZE))
    draw = ImageDraw.Draw(img)
    c = [
        (180, 40, 40),   # 1. 紅
        (30, 60, 120),   # 2. 藍
        (70, 130, 60),   # 3. 萌黄
        (220, 160, 30),  # 4. 山吹
        (110, 50, 120),  # 5. 紫
        (100, 60, 40),   # 6. 焦茶
        (40, 150, 150),  # 7. 浅葱
        (240, 240, 235), # 8. 卯の花
    ]
    step = 64
    for y in range(0, SIZE, step):
        for x in range(0, SIZE, step):
            base_idx = ((x // step) * 3 + (y // step) * 5) % 8
            draw.rectangle([x, y, x + step, y + step], fill=c[base_idx])
            mx, my = x + step // 2, y + step // 2
            draw.polygon([(x, y), (mx, y), (x, my)], fill=c[(base_idx + 1) % 8])
            draw.polygon([(mx, y), (x + step, y), (x + step, my)], fill=c[(base_idx + 2) % 8])
            draw.polygon([(x + step, my), (x + step, y + step), (mx, y + step)], fill=c[(base_idx + 3) % 8])
            draw.polygon([(mx, y + step), (x, y + step), (x, my)], fill=c[(base_idx + 4) % 8])
            draw.polygon([(mx, y), (x + step, my), (mx, y + step), (x, my)], fill=c[(base_idx + 7) % 8])
    return img


# ─────────────────────────────────────────────────────────────────────────────
# 洋風パターンスイート
# ─────────────────────────────────────────────────────────────────────────────

# 8. 洋風・千鳥格子 (Houndstooth) - 2色
def gen_houndstooth():
    img = Image.new("RGB", (SIZE, SIZE))
    draw = ImageDraw.Draw(img)
    c_dark = (36, 36, 36)
    c_light = (251, 251, 251)
    tile = 64
    for y in range(0, SIZE, tile):
        for x in range(0, SIZE, tile):
            draw.rectangle([x, y, x + tile, y + tile], fill=c_light)
            sub = tile // 2
            # 伝統的な千鳥格子の基本セル
            draw.rectangle([x, y, x + sub, y + sub], fill=c_dark)
            # トゲ
            draw.polygon([(x + sub, y), (x + tile, y), (x + sub, y + sub)], fill=c_dark)
            draw.polygon([(x, y + sub), (x, y + tile), (x + sub, y + sub)], fill=c_dark)
            draw.polygon([(x + sub, y + sub), (x + tile, y + sub), (x + sub, y + tile)], fill=c_dark)
    return img

# 9. 洋風・シェブロン (Chevron Zigzag) - 2色
def gen_chevron():
    img = Image.new("RGB", (SIZE, SIZE))
    draw = ImageDraw.Draw(img)
    c_navy = (25, 42, 86)
    c_gold = (251, 197, 49)
    band_h = 32
    for y in range(-band_h, SIZE + band_h, band_h * 2):
        pts1 = []
        pts2 = []
        for x in range(0, SIZE + 64, 64):
            peak = 0 if (x // 64) % 2 == 0 else band_h
            pts1.append((x, y + peak))
        for x in range(SIZE + 64, -64, -64):
            peak = 0 if (x // 64) % 2 == 0 else band_h
            pts1.append((x, y + peak + band_h))
        draw.polygon(pts1, fill=c_navy)
        
        for x in range(0, SIZE + 64, 64):
            peak = 0 if (x // 64) % 2 == 0 else band_h
            pts2.append((x, y + peak + band_h))
        for x in range(SIZE + 64, -64, -64):
            peak = 0 if (x // 64) % 2 == 0 else band_h
            pts2.append((x, y + peak + band_h * 2))
        draw.polygon(pts2, fill=c_gold)
    return img

# 10. 洋風・ヘリンボーン (Herringbone) - 3色
def gen_herringbone():
    img = Image.new("RGB", (SIZE, SIZE))
    draw = ImageDraw.Draw(img)
    c1 = (44, 62, 80)    # フォレストスレート
    c2 = (211, 84, 0)    # テラコッタ
    c3 = (236, 240, 241) # サンドベージュ
    colors = [c1, c2, c3]
    block_w = 64
    block_h = 32
    for y in range(0, SIZE, block_h):
        row = y // block_h
        for x in range(0, SIZE, block_w):
            col = x // block_w
            color = colors[(row + col * 2) % 3]
            draw.rectangle([x, y, x + block_w - 2, y + block_h - 2], fill=color)
    return img

# 11. 洋風・アーガイル (Argyle Diamond) - 3色
def gen_argyle():
    img = Image.new("RGB", (SIZE, SIZE))
    draw = ImageDraw.Draw(img)
    c_bordeaux = (108, 29, 40)
    c_slate = (58, 63, 71)
    c_ivory = (243, 237, 226)
    dw = 64
    dh = 64
    for y in range(0, SIZE, dh):
        for x in range(0, SIZE, dw):
            draw.rectangle([x, y, x + dw, y + dh], fill=c_slate)
            mx, my = x + dw // 2, y + dh // 2
            draw.polygon([(mx, y), (x + dw, my), (mx, y + dh), (x, my)], fill=c_bordeaux)
            draw.rectangle([mx - 4, my - 4, mx + 4, my + 4], fill=c_ivory)
            # 対角ステッチ
            draw.line([(x, y), (x + dw, y + dh)], fill=c_ivory, width=2)
            draw.line([(x + dw, y), (x, y + dh)], fill=c_ivory, width=2)
    return img

# 12. 洋風・モロッカンタイル (Moroccan Arabesque) - 4色
def gen_moroccan():
    img = Image.new("RGB", (SIZE, SIZE))
    draw = ImageDraw.Draw(img)
    c1 = (9, 132, 227)   # コバルト
    c2 = (0, 206, 201)   # ターコイズ
    c3 = (225, 112, 85)  # サンセットオレンジ
    c4 = (223, 230, 233) # パールクリーム
    colors = [c1, c2, c3, c4]
    step = 64
    for y in range(0, SIZE, step):
        for x in range(0, SIZE, step):
            idx = ((x // step) + (y // step) * 2) % 4
            draw.rectangle([x, y, x + step, y + step], fill=colors[idx])
            # 中央のオージー/ランタン形状
            mx, my = x + step // 2, y + step // 2
            r = step // 3
            draw.ellipse([mx - r, my - r, mx + r, my + r], fill=colors[(idx + 1) % 4])
            draw.polygon([(mx, y), (x + step, my), (mx, y + step), (x, my)], outline=colors[(idx + 2) % 4], width=2)
    return img

# 13. 洋風・タータンチェック (Tartan Plaid) - 4色
def gen_tartan():
    img = Image.new("RGB", (SIZE, SIZE))
    draw = ImageDraw.Draw(img)
    c_red = (166, 28, 28)
    c_green = (20, 70, 42)
    c_blue = (24, 49, 91)
    c_yellow = (229, 173, 22)
    step = 64
    for y in range(0, SIZE, step):
        for x in range(0, SIZE, step):
            cx = (x // step) % 2
            cy = (y // step) % 2
            if cx == 0 and cy == 0:
                col = c_red
            elif cx == 1 and cy == 1:
                col = c_green
            else:
                col = c_blue
            draw.rectangle([x, y, x + step, y + step], fill=col)
            # 黄色のアクセントライン
            draw.line([(x, y + step // 2), (x + step, y + step // 2)], fill=c_yellow, width=4)
            draw.line([(x + step // 2, y), (x + step // 2, y + step)], fill=c_yellow, width=4)
    return img

# 14. 洋風・ステンドグラス (Stained Glass 8-Color) - 8色
def gen_stained_glass():
    img = Image.new("RGB", (SIZE, SIZE))
    draw = ImageDraw.Draw(img)
    palette = [
        (192, 57, 43),   # ルビー
        (41, 128, 185),  # サファイア
        (39, 174, 96),   # エメラルド
        (243, 156, 18),  # アンバー
        (142, 68, 173),  # アメジスト
        (211, 84, 0),    # トパーズ
        (22, 160, 133),  # ティールアクア
        (236, 240, 241), # フロストホワイト
    ]
    step = 64
    for y in range(0, SIZE, step):
        for x in range(0, SIZE, step):
            b_idx = ((x // step) * 2 + (y // step) * 3) % 8
            draw.polygon([(x, y), (x + step, y), (x + step // 2, y + step // 2)], fill=palette[b_idx], outline=(20, 20, 20), width=2)
            draw.polygon([(x + step, y), (x + step, y + step), (x + step // 2, y + step // 2)], fill=palette[(b_idx + 1) % 8], outline=(20, 20, 20), width=2)
            draw.polygon([(x + step, y + step), (x, y + step), (x + step // 2, y + step // 2)], fill=palette[(b_idx + 2) % 8], outline=(20, 20, 20), width=2)
            draw.polygon([(x, y + step), (x, y), (x + step // 2, y + step // 2)], fill=palette[(b_idx + 3) % 8], outline=(20, 20, 20), width=2)
    return img


# ─────────────────────────────────────────────────────────────────────────────
# 幾何学パターンスイート
# ─────────────────────────────────────────────────────────────────────────────

# 15. 幾何学・六角ハニカム (Hexagonal Honeycomb) - 2色
def gen_honeycomb():
    img = Image.new("RGB", (SIZE, SIZE), (45, 52, 54)) # ダークスレート
    draw = ImageDraw.Draw(img)
    c_cyan = (0, 210, 211)
    step_x = 64
    step_y = int(64 * math.sqrt(3) / 2)
    r = 24
    for row in range(-1, SIZE // step_y + 2):
        y = row * step_y
        offset_x = (step_x // 2) if row % 2 == 1 else 0
        for col in range(-1, SIZE // step_x + 2):
            x = col * step_x + offset_x
            pts = []
            for i in range(6):
                angle = math.radians(60 * i + 30)
                pts.append((x + r * math.cos(angle), y + r * math.sin(angle)))
            draw.polygon(pts, fill=c_cyan, outline=(45, 52, 54), width=3)
    return img

# 16. 幾何学・等辺三角モザイク (Triangle Mosaic) - 3色
def gen_triangle_mosaic():
    img = Image.new("RGB", (SIZE, SIZE))
    draw = ImageDraw.Draw(img)
    c1 = (255, 107, 107) # コーラル
    c2 = (29, 209, 161)  # ミント
    c3 = (34, 47, 62)    # ディープスレート
    colors = [c1, c2, c3]
    step = 64
    for y in range(0, SIZE, step):
        for x in range(0, SIZE, step):
            idx = ((x // step) + (y // step)) % 3
            # 対角線で2分して三角タイル
            draw.polygon([(x, y), (x + step, y), (x, y + step)], fill=colors[idx])
            draw.polygon([(x + step, y), (x + step, y + step), (x, y + step)], fill=colors[(idx + 1) % 3])
    return img

# 17. 幾何学・アイソメトリックキューブ (Isometric 3D Cubes) - 3色
def gen_isometric_cubes():
    img = Image.new("RGB", (SIZE, SIZE))
    draw = ImageDraw.Draw(img)
    c_top = (245, 246, 250)   # 明面 (上)
    c_left = (75, 75, 160)    # 中間面 (左)
    c_right = (35, 35, 90)    # 暗面 (右)
    step = 64
    for y in range(0, SIZE, step):
        for x in range(0, SIZE, step):
            mx, my = x + step // 2, y + step // 2
            # 菱形タイルで3Dキューブ錯視
            draw.polygon([(x, y), (mx, y - step // 4), (x + step, y), (mx, y + step // 4)], fill=c_top)
            draw.polygon([(x, y), (mx, y + step // 4), (mx, y + step), (x, y + step * 3 // 4)], fill=c_left)
            draw.polygon([(mx, y + step // 4), (x + step, y), (x + step, y + step * 3 // 4), (mx, y + step)], fill=c_right)
    return img

# 18. 幾何学・八角＆正方形タイル (Octagon & Square) - 4色
def gen_octagon_square():
    img = Image.new("RGB", (SIZE, SIZE))
    draw = ImageDraw.Draw(img)
    c_dark = (47, 53, 66)
    c_orange = (230, 126, 34)
    c_teal = (22, 160, 133)
    c_pearl = (241, 242, 246)
    step = 64
    c = 18 # 八角形の切り欠き幅
    for y in range(0, SIZE, step):
        for x in range(0, SIZE, step):
            idx = ((x // step) + (y // step)) % 2
            oct_color = c_orange if idx == 0 else c_teal
            pts_oct = [
                (x + c, y), (x + step - c, y),
                (x + step, y + c), (x + step, y + step - c),
                (x + step - c, y + step), (x + c, y + step),
                (x, y + step - c), (x, y + c)
            ]
            draw.polygon(pts_oct, fill=oct_color)
            # 四隅の正方形/菱形
            draw.polygon([(x, y), (x + c, y), (x, y + c)], fill=c_dark)
            draw.polygon([(x + step - c, y), (x + step, y), (x + step, y + c)], fill=c_pearl)
            draw.polygon([(x + step, y + step - c), (x + step, y + step), (x + step - c, y + step)], fill=c_dark)
            draw.polygon([(x, y + step - c), (x + c, y + step), (x, y + step)], fill=c_pearl)
    return img

# 19. 幾何学・カレイドスコープ 8色 (Kaleidoscope 8-Color) - 8色
def gen_kaleidoscope():
    img = Image.new("RGB", (SIZE, SIZE))
    draw = ImageDraw.Draw(img)
    p = [
        (235, 77, 75),   # 1. Carmine Red
        (240, 147, 43),  # 2. Tangerine Orange
        (249, 202, 36),  # 3. Pure Yellow
        (106, 176, 76),  # 4. Lime Green
        (34, 166, 179),  # 5. Blue Lagoon
        (48, 51, 107),   # 6. Deep Indigo
        (190, 46, 221),  # 7. Magenta Purple
        (248, 239, 186), # 8. Pale Vanilla
    ]
    step = 128
    for y in range(0, SIZE, step):
        for x in range(0, SIZE, step):
            cx, cy = x + step // 2, y + step // 2
            r = step // 2
            # 8扇形セクター
            for i in range(8):
                a1 = math.radians(45 * i)
                a2 = math.radians(45 * (i + 1))
                pts = [(cx, cy), (cx + r * math.cos(a1), cy + r * math.sin(a1)), (cx + r * math.cos(a2), cy + r * math.sin(a2))]
                draw.polygon(pts, fill=p[i])
                # 内部スター
                r_in = r // 2
                pts_in = [(cx, cy), (cx + r_in * math.cos(a1), cy + r_in * math.sin(a1)), (cx + r_in * math.cos(a2), cy + r_in * math.sin(a2))]
                draw.polygon(pts_in, fill=p[(i + 4) % 8])
    return img

# ─────────────────────────────────────────────────────────────────────────────
# 実行部
# ─────────────────────────────────────────────────────────────────────────────
textures = [
    ("ichimatsu_2color", gen_ichimatsu),
    ("seigaiha_2color", gen_seigaiha),
    ("yagasuri_2color", gen_yagasuri),
    ("asanoha_3color", gen_asanoha),
    ("tomoe_3color", gen_tomoe),
    ("kikko_4color", gen_kikko),
    ("kagome_8color", gen_kagome),
    ("houndstooth_2color", gen_houndstooth),
    ("chevron_2color", gen_chevron),
    ("herringbone_3color", gen_herringbone),
    ("argyle_3color", gen_argyle),
    ("moroccan_4color", gen_moroccan),
    ("tartan_4color", gen_tartan),
    ("stained_glass_8color", gen_stained_glass),
    ("honeycomb_2color", gen_honeycomb),
    ("triangle_mosaic_3color", gen_triangle_mosaic),
    ("isometric_cubes_3color", gen_isometric_cubes),
    ("octagon_square_4color", gen_octagon_square),
    ("kaleidoscope_8color", gen_kaleidoscope),
]

for name, func in textures:
    img = func()
    save_texture_and_thumb(img, name)

print(f"Successfully generated all {len(textures)} textures!")

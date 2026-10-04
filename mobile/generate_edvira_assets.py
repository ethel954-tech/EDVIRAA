from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

os.makedirs("assets", exist_ok=True)

bg = (235, 244, 243)

# Icon canvas
icon = Image.new("RGBA", (1024, 1024), bg)
icon_draw = ImageDraw.Draw(icon)

# teal gradient background
for y in range(1024):
    ratio = y / 1024
    r = int(20 + ratio * 30)
    g = int(148 + ratio * 30)
    b = int(138 + ratio * 40)
    icon_draw.line([(0, y), (1024, y)], fill=(r, g, b, 255))

# wing/book base
wing = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
wd = ImageDraw.Draw(wing)
wing_points = [
    (142, 680), (363, 470), (485, 546), (651, 477),
    (705, 494), (916, 354), (1018, 385), (760, 752), (590, 772), (380, 754), (230, 785)
]
wd.polygon(wing_points, fill=(13, 135, 130, 160))
wd.polygon([(170, 690), (470, 520), (690, 705), (360, 815), (170, 770)], fill=(13, 160, 150, 190))
wing = wing.filter(ImageFilter.GaussianBlur(6))
icon.alpha_composite(wing)

# cap
cap = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
cd = ImageDraw.Draw(cap)
cd.polygon([(212, 245), (478, 110), (780, 245), (520, 260)], fill=(17, 173, 165, 255))
cd.polygon([(242, 248), (472, 132), (742, 248), (518, 258)], fill=(8, 149, 138, 255))
cd.rounded_rectangle([260, 240, 770, 330], radius=25, fill=(12, 162, 152, 255))
cd.rounded_rectangle([510, 320, 535, 470], radius=14, fill=(11, 118, 117, 255))
cd.ellipse((498, 470, 545, 530), fill=(11, 118, 117, 255))
icon.alpha_composite(cap)

# main abstract E mark
mark = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
md = ImageDraw.Draw(mark)
md.polygon([
    (238, 710), (510, 220), (720, 220), (610, 310),
    (890, 170), (970, 250), (702, 410), (900, 410),
    (930, 480), (700, 480), (770, 616), (930, 615),
    (970, 700), (620, 700), (780, 830), (470, 830),
    (250, 780), (193, 740)
], fill=(18, 168, 156, 255))
md.polygon([
    (138, 650), (430, 350), (570, 350), (410, 500),
    (510, 600), (330, 750), (195, 760), (168, 710)
], fill=(6, 126, 117, 255))
md.polygon([
    (378, 630), (505, 370), (622, 370), (538, 520),
    (650, 540), (705, 600), (645, 670), (518, 665),
    (550, 760), (408, 760), (318, 700)
], fill=(233, 246, 243, 240))
md.polygon([(754, 390), (774, 430), (814, 430), (782, 452), (794, 490), (754, 468), (714, 490), (726, 452), (694, 430), (734, 430)], fill=(255,255,255,220))
md.rounded_rectangle([725, 508, 772, 560], radius=10, fill=(255,255,255,230))

# white outline glow
for i in range(14):
    overlay = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.polygon([
        (238, 710), (510, 220), (720, 220), (610, 310),
        (890, 170), (970, 250), (702, 410), (900, 410),
        (930, 480), (700, 480), (770, 616), (930, 615),
        (970, 700), (620, 700), (780, 830), (470, 830),
        (250, 780), (193, 740)
    ], outline=(255, 255, 255, 30), width=3 + i)
    icon.alpha_composite(overlay)

icon.alpha_composite(mark)

# top highlight
cap_highlight = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
chd = ImageDraw.Draw(cap_highlight)
chd.polygon([(292, 228), (480, 158), (602, 182), (505, 248)], fill=(255, 255, 255, 60))
icon.alpha_composite(cap_highlight)

# Save square icon and adaptive icon
icon.save("assets/edvira-icon.png")
icon.save("assets/adaptive-icon.png")

# Splash screen with centered brand mark and text
splash = Image.new("RGBA", (1242, 2436), (244, 250, 248, 255))
logo = icon.resize((860, 860))
splash.paste(logo, (191, 200), logo)
font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 220)
text = "EDVIRA"
text_bbox = font.getbbox(text)
text_w = text_bbox[2] - text_bbox[0]
text_x = (1242 - text_w) // 2
text_y = 1260
for dx, dy in [(0, 14), (0, 0)]:
    d = ImageDraw.Draw(splash)
    d.text((text_x + dx, text_y + dy), text, font=font, fill=(14, 77, 70, 255))
splash.save("assets/edvira-splash.png")

print("Generated assets in ./assets")

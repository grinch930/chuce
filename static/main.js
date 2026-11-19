// 出册 · 山海图录 —— 可翻页、可出册的立体书
import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { MeshoptDecoder } from './vendor/meshopt_decoder.module.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';
import * as SFX from './sound.js';

const $ = (id) => document.getElementById(id);
const SERIF = '"Noto Serif SC","Songti SC","STSong","SimSun","Source Han Serif SC",serif';
const BRUSH = '"Ma Shan Zheng","STKaiti","KaiTi","Kaiti SC",' + SERIF;

/* ------------------------------------------------------------------ 基本场景 */
const canvas = $('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x120c08);
scene.fog = new THREE.Fog(0x120c08, 13, 30);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;

const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 60);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 2.2;
controls.maxDistance = 45;
controls.maxPolarAngle = Math.PI * 0.47;
controls.enabled = false;

// 灯：一盏偏暖的台灯 + 冷一点的天光
scene.add(new THREE.HemisphereLight(0xfff1dc, 0x2a1d14, 0.9));
const lamp = new THREE.DirectionalLight(0xffe2bd, 2.4);
lamp.position.set(-3.5, 7.5, 4.2);
lamp.castShadow = true;
lamp.shadow.mapSize.set(2048, 2048);
Object.assign(lamp.shadow.camera, { left: -4.5, right: 4.5, top: 4.5, bottom: -4.5, near: 1, far: 20 });
lamp.shadow.bias = -0.0004;
lamp.shadow.normalBias = 0.02;
lamp.shadow.radius = 5;
scene.add(lamp);
const rim = new THREE.DirectionalLight(0xbfd2ff, 0.55);
rim.position.set(4, 3, -5);
scene.add(rim);

/* ------------------------------------------------------------------ 纹理工具 */
function rand(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function canvasTex(c, { repeat = null, aniso = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (aniso) t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}
function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }

// 旧纸底：纤维、斑点、边缘泛黄
function paintPaper(g, w, h, seed = 7, base = '#ece0c4') {
  const r = rand(seed);
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < w * h / 90; i++) {
    const v = r();
    g.fillStyle = v > .5 ? `rgba(255,250,235,${r() * .07})` : `rgba(120,90,50,${r() * .06})`;
    g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
  }
  g.lineWidth = 0.7;
  for (let i = 0; i < 380; i++) {
    g.strokeStyle = `rgba(110,85,50,${.03 + r() * .05})`;
    const x = r() * w, y = r() * h, a = r() * Math.PI, l = 6 + r() * 26;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * l * .5 + r() * 4, y + Math.sin(a) * l * .5, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  for (let i = 0; i < 9; i++) { // 水渍
    const x = r() * w, y = r() * h, rr = 30 + r() * 120;
    const gr = g.createRadialGradient(x, y, rr * .2, x, y, rr);
    gr.addColorStop(0, 'rgba(160,120,60,0)'); gr.addColorStop(.85, `rgba(150,110,55,${.025 + r() * .03})`); gr.addColorStop(1, 'rgba(150,110,55,0)');
    g.fillStyle = gr; g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
  const edge = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * .35, w / 2, h / 2, Math.max(w, h) * .75);
  edge.addColorStop(0, 'rgba(120,80,30,0)'); edge.addColorStop(1, 'rgba(120,80,30,.22)');
  g.fillStyle = edge; g.fillRect(0, 0, w, h);
}

/* ------------------------------------------------------------------ 尺寸 */
const PAGE_W = 2.5, PAGE_D = 3.4;     // 单页宽、深
const BOARD_T = 0.06, BLOCK_T = 0.16; // 封板、书芯厚
const PT = BOARD_T + BLOCK_T;         // 页面高度
const GAP = 0.02;
const PLATE = 2.05;                   // 图版边长
const PLATE_X = -(GAP + PAGE_W / 2) - 0.02;
const PLATE_Z = -0.38;

/* ------------------------------------------------------------------ 书桌 */
// 桌面照片按原比例铺开（不拉伸），尺度约为书宽的四五倍，像一张真正的书案
const DESK_W = 24;
const deskMat = new THREE.MeshStandardMaterial({ color: 0x3a281c, roughness: .58, metalness: 0, envMapIntensity: 0.5 });
const desk = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), deskMat);
desk.rotation.x = -Math.PI / 2; desk.receiveShadow = true; desk.scale.set(DESK_W, DESK_W * 941 / 1672, 1);
desk.position.set(1.2, 0, 0.6); // 让照片里左上角的光斑落在书的左后方，与台灯方向一致
scene.add(desk);
function setDeskImage(img) {
  const t = new THREE.Texture(img); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  // 中间一块是原图，四周镜像延展，远处交给雾——镜头放低时看不到桌子的边
  t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping; t.repeat.set(3, 3); t.offset.set(-1, -1); t.needsUpdate = true;
  deskMat.map = t; deskMat.color.set(DESK_TINT); deskMat.needsUpdate = true;
  desk.scale.set(DESK_W * 3, DESK_W * 3 * img.height / img.width, 1);
}
const DESK_TINT = 0x6a6a6a; // 照片自带光影，压低受光，保持深胡桃色

// 书下的接触阴影（环境光遮蔽）：让书“压”在桌上
function aoTex() {
  const [c, g] = mk(256, 256);
  const gr = g.createRadialGradient(128, 128, 30, 128, 128, 128);
  gr.addColorStop(0, 'rgba(0,0,0,.85)'); gr.addColorStop(.55, 'rgba(0,0,0,.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); return t;
}
const AO_T = aoTex();
function aoQuad(w, d) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: AO_T, transparent: true, depthWrite: false, opacity: .75 }));
  m.rotation.x = -Math.PI / 2; m.renderOrder = -1; return m;
}

/* ------------------------------------------------------------------ 书 */
// 书口：一层层纸边（各书共用）
const [edgeC, edgeG] = mk(64, 256);
{ const r = rand(5); edgeG.fillStyle = '#d8c9a6'; edgeG.fillRect(0, 0, 64, 256);
  for (let y = 0; y < 256; y += 2) { edgeG.fillStyle = `rgba(90,70,40,${.08 + r() * .12})`; edgeG.fillRect(0, y, 64, 1); } }
const edgeTex = canvasTex(edgeC, { aniso: false }); edgeTex.wrapS = THREE.RepeatWrapping; edgeTex.repeat.set(8, 1);
const edgeMat = new THREE.MeshStandardMaterial({ map: edgeTex, roughness: .95 });
// 西式书口：烫金
const edgeGoldMat = new THREE.MeshStandardMaterial({ color: 0xc9a45c, roughness: .45, metalness: .55 });

function imgTex(img, { repeat, mirror, rot } = {}) {
  const t = new THREE.Texture(img); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  if (repeat) { t.wrapS = t.wrapT = mirror ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping; t.repeat.set(repeat, repeat); }
  if (rot) { t.center.set(0.5, 0.5); t.rotation = rot; }
  t.needsUpdate = true; return t;
}

// 一侧书页（书板 + 书芯 + 微弯的页面）；mats：{ cloth, cover }，cover 贴在该侧书板的 -y 面（合上时朝上）
function makeHalf(side, pageMap, mats, gilt) {
  const half = new THREE.Group();
  const sx = side; // -1 左，+1 右
  const bw = PAGE_W + 0.12, bd = PAGE_D + 0.16;
  const boardMats = [mats.cloth, mats.cloth, mats.cloth, mats.cloth, mats.cloth, mats.cloth];
  if (mats.cover) boardMats[3] = mats.cover;
  const board = new THREE.Mesh(new THREE.BoxGeometry(bw, BOARD_T, bd), boardMats);
  board.position.set(sx * (GAP / 2 + bw / 2 - 0.02), BOARD_T / 2, 0);
  board.castShadow = board.receiveShadow = true; half.add(board);

  const em = gilt ? edgeGoldMat : edgeMat;
  const block = new THREE.Mesh(new THREE.BoxGeometry(PAGE_W, BLOCK_T - 0.01, PAGE_D), [em, em, em, em, em, em]);
  block.position.set(sx * (GAP / 2 + PAGE_W / 2), BOARD_T + (BLOCK_T - 0.01) / 2, 0);
  block.castShadow = block.receiveShadow = true; half.add(block);

  // 页面：靠书脊处微微下陷
  const geo = new THREE.PlaneGeometry(PAGE_W, PAGE_D, 60, 1);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + PAGE_W / 2; // 0..W 离书脊
    const d = side > 0 ? x : PAGE_W - x;
    p.setY(i, -0.012 + 0.012 * (1 - Math.exp(-d * 14)) - 0.004 * (d / PAGE_W));
  }
  geo.computeVertexNormals();
  const page = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: pageMap, roughness: .93, color: 0xe9e0cf }));
  page.position.set(sx * (GAP / 2 + PAGE_W / 2), PT, 0);
  page.receiveShadow = true; half.add(page); half.userData.page = page;
  return half;
}

/* ================================================================== 图录：每一页一只兽 */
// 形变代码在各兽“原始模型坐标”里写（Lux3D 输出：Y 向上；正视 = 画中的样子）
const BEASTS = [
  {
    id: 'fox', model: 'foxc', plate: 'plate.jpg', fitW: 0.97,
    name: '九尾狐', pageName: '九 尾 狐', pageSub: '青 丘 之 山 · 南 山 經 第 一', nums: ['壹', '貳'],
    brand: '卷一 · 南山经 · 图版壹',
    header: '南山經　卷一', footer: '　　右圖九尾狐一', mark: '如狐而九尾',
    body: '又東三百里曰青丘之山其陽多玉其陰多青雘有獸焉其狀如狐而九尾其音如嬰兒能食人食者不蠱有鳥焉其狀如鳩其音若呵名曰灌灌佩之不惑英水出焉南流注于即翼之澤其中多赤鱬其狀如魚而人面其音如鴛鴦食之不疥',
    note: { h: '九尾狐', rows: [['所居', '青丘之山。其阳多玉，其阴多青雘。'], ['其状', '如狐而九尾，其音如婴儿。'], ['见之则', '世传为太平之瑞；食者不蛊。']], src: '出《南山经》', stamp: '青丘' },
    voice: 'cry', ears: true, acts: ['glory'],
    headC: [0.35, 0.15, 0.95], restAz: 0.55, pitchAxis: [-1, 0, 0], yaw: [-0.55, 0.45], pitch: [-0.18, 0.22],
    scenery: 'qingqiu', world: 'qq_world.jpg', worldTint: 0xfff1d8,
    glsl: /* glsl */`
      float headW(vec3 m){ return smoothstep(0.52, 0.80, m.z) * smoothstep(-0.42, -0.12, m.y); }
      const vec3 NECK = vec3(0.22, -0.18, 0.58);
      float earW(vec3 m){ return headW(m) * smoothstep(0.22, 0.42, m.y); }
      vec3 earPivot(vec3 m){ return vec3(m.x, 0.24, m.z); }
      float earDir(vec3 m){ return sign(m.x - 0.3); }
      vec3 bodyMove(vec3 m){
        vec3 o = m;
        // 九尾：绕尾根缓摆
        vec2 root = vec2(-0.05, -0.15);
        vec2 d = m.xy - root; float dist = length(d);
        float tw = smoothstep(0.75, 1.85, dist) * max(smoothstep(-1.0, -0.45, m.y), smoothstep(0.95, 1.35, abs(m.x)));
        tw *= 1.0 - smoothstep(0.45, 0.75, m.z);
        float ang = atan(d.y, d.x);
        float a = uSway * tw * (0.07 * sin(uTime * 1.3 + ang * 2.7) + 0.03 * sin(uTime * 2.1 + ang * 5.0));
        o.xy = root + mat2(cos(a), sin(a), -sin(a), cos(a)) * d;
        o.z += uSway * tw * tw * 0.10 * sin(uTime * 1.1 + ang * 3.3);
        // 呼吸
        vec3 chest = vec3(0.12, -0.45, 0.35);
        float bw = (1.0 - smoothstep(0.15, 0.62, length((m - chest) * vec3(1.0, 1.25, 1.0)))) * (1.0 - headW(m));
        o += normalize(m - chest + vec3(1e-4)) * (0.5 + 0.5 * sin(uTime * 1.9)) * 0.022 * uLife * bw;
        return o;
      }`,
  },
  {
    id: 'zheng', model: 'm2c', plate: 'plate_m2.jpg', fitW: 0.9,
    name: '狰', pageName: '猙', pageSub: '章 莪 之 山 · 西 山 經 第 二', nums: ['叁', '肆'],
    brand: '卷二 · 西山经 · 图版贰',
    header: '西山經　卷二', footer: '　　右圖猙一', mark: '五尾一角',
    body: '又西二百八十里曰章莪之山無草木多瑤碧所為甚怪有獸焉其狀如赤豹五尾一角其音如擊石其名曰猙有鳥焉其狀如鶴一足赤文青質而白喙名曰畢方其鳴自叫也見則其邑有譌火',
    note: { h: '狰', rows: [['所居', '章莪之山。无草木，多瑶碧，所为甚怪。'], ['其状', '如赤豹，五尾一角。'], ['其音', '如击石。']], src: '出《西山经》', stamp: '章莪' },
    voice: 'stone', acts: ['strike', 'seal'],
    headC: [-1.0, 0.3, 0.0], restAz: -Math.PI / 2, pitchAxis: [0, 0, -1], yaw: [-0.3, 0.62], pitch: [-0.15, 0.2],
    scenery: 'zhange', world: 'zg_world.jpg', worldTint: 0xfff0d8,
    glsl: /* glsl */`
      float headW(vec3 m){ return (1.0 - smoothstep(-0.88, -0.60, m.x)) * smoothstep(-0.32, -0.08, m.y); }
      const vec3 NECK = vec3(-0.60, 0.18, 0.0);
      float earW(vec3 m){ return 0.0; }
      vec3 earPivot(vec3 m){ return m; }
      float earDir(vec3 m){ return 0.0; }
      vec3 bodyMove(vec3 m){
        vec3 o = m;
        // 五尾：从尾根散开，各自错开相位
        vec2 root = vec2(0.60, 0.18);
        vec2 d = m.xy - root; float dist = length(d);
        float tw = smoothstep(0.50, 0.78, m.x) * smoothstep(-0.38, -0.12, m.y) * smoothstep(0.06, 0.55, dist);
        float ang = atan(d.y, d.x) + m.z * 2.5;
        float a = uSway * tw * (0.10 * sin(uTime * 1.4 + ang * 2.2) + 0.04 * sin(uTime * 2.3 + ang * 4.0));
        o.xy = root + mat2(cos(a), sin(a), -sin(a), cos(a)) * d;
        o.z += uSway * tw * 0.07 * sin(uTime * 1.2 + ang * 3.0);
        // 呼吸
        vec3 chest = vec3(-0.35, -0.15, 0.0);
        float bw = (1.0 - smoothstep(0.12, 0.55, length((m - chest) * vec3(1.0, 1.2, 1.3)))) * (1.0 - headW(m));
        o += normalize(m - chest + vec3(1e-4)) * (0.5 + 0.5 * sin(uTime * 1.6)) * 0.024 * uLife * bw;
        return o;
      }`,
  },
  {
    id: 'yinglong', model: 'm3c', plate: 'plate_m3.jpg', fitW: 0.9,
    name: '应龙', pageName: '應 龍', pageSub: '凶 犁 土 丘 · 大 荒 東 經', nums: ['伍', '陸'],
    brand: '卷十四 · 大荒东经 · 图版叁',
    header: '大荒東經　卷十四', footer: '　　右圖應龍一', mark: '應龍處南極',
    body: '大荒東北隅中有山名曰凶犁土丘應龍處南極殺蚩尤與夸父不得復上故下數旱旱而為應龍之狀乃得大雨',
    gloss: '郭璞注曰應龍龍有翼者也',
    note: { h: '应龙', rows: [['所处', '南极。大荒东北隅，凶犁土丘。'], ['其事', '杀蚩尤与夸父，不得复上，故下数旱。'], ['见之则', '旱而为应龙之状，乃得大雨。']], src: '出《大荒东经》· 郭璞注：龙有翼者也', stamp: '应龙' },
    voice: 'thunder', hover: 0.32, acts: ['rain'],
    headC: [-0.1, 0.03, 0.0], restAz: -Math.PI / 2, pitchAxis: [0, 0, -1], yaw: [-0.3, 0.6], pitch: [-0.15, 0.25],
    scenery: 'dahuang', world: 'yl_world.jpg', worldTint: 0xe8eef0,
    glsl: /* glsl */`
      float headW(vec3 m){ return (1.0 - smoothstep(-0.092, -0.062, m.x)) * smoothstep(-0.034, -0.016, m.y); }
      const vec3 NECK = vec3(-0.056, 0.012, 0.0);
      float earW(vec3 m){ return 0.0; }
      vec3 earPivot(vec3 m){ return m; }
      float earDir(vec3 m){ return 0.0; }
      vec3 bodyMove(vec3 m){
        vec3 o = m;
        // 双翼：绕肩线上下扇动
        float sz = m.z >= 0.0 ? 1.0 : -1.0;
        float ww = smoothstep(0.010, 0.030, abs(m.z)) * smoothstep(-0.012, 0.010, m.y) * (1.0 - headW(m));
        vec2 piv = vec2(0.008, sz * 0.010);
        vec2 yz = m.yz - piv;
        float fl = sz * ww * uSway * (0.30 * sin(uTime * 2.6) + 0.05);
        o.yz = piv + mat2(cos(fl), sin(fl), -sin(fl), cos(fl)) * yz;
        // 长尾：自根部起波动
        vec2 root = vec2(0.0, -0.02);
        vec2 d = m.xy - root; float dist = length(d);
        float tw = smoothstep(0.015, 0.05, m.x) * (1.0 - smoothstep(-0.02, 0.005, m.y)) * smoothstep(0.02, 0.14, dist);
        float a = uSway * tw * 0.14 * sin(uTime * 1.6 - dist * 30.0);
        o.xy = mix(o.xy, root + mat2(cos(a), sin(a), -sin(a), cos(a)) * d, step(0.0001, tw));
        o.z += uSway * tw * 0.012 * sin(uTime * 2.0 - dist * 40.0);
        // 呼吸
        vec3 chest = vec3(-0.03, -0.02, 0.0);
        float bw = (1.0 - smoothstep(0.01, 0.05, length(m - chest))) * (1.0 - headW(m));
        o += normalize(m - chest + vec3(1e-5)) * (0.5 + 0.5 * sin(uTime * 1.5)) * 0.0016 * uLife * bw;
        return o;
      }`,
  },
];

// 第二本：爱丽丝漫游奇境（卡罗尔原著 1865，公有领域；中文为本页自译）
const ALICE = [
  {
    id: 'alice', model: 'm4c', plate: 'plate_alice.jpg', fitW: 0.9, style: 'west',
    name: '爱丽丝', pageName: 'Alice', pageSub: 'Chapter I. — Down the Rabbit-Hole', nums: ['2', '3'],
    brand: '第一章 · 掉进兔子洞 · 插图一',
    chapter: 'CHAPTER I.', title: 'Down the Rabbit-Hole.',
    paras: [
      'Either the well was very deep, or she fell very slowly, for she had plenty of time as she went down to look about her and to wonder what was going to happen next. First, she tried to look down and make out what she was coming to, but it was too dark to see anything; then she looked at the sides of the well, and noticed that they were filled with cupboards and book-shelves; here and there she saw maps and pictures hung upon pegs.',
      'Down, down, down. Would the fall never come to an end?',
    ],
    gloss: '井壁上满是橱柜和书架',
    note: { h: '爱丽丝', rows: [['所在', '兔子洞。井壁上满是橱柜和书架，钉子上挂着地图和画。'], ['其时', '她落得很慢，有足够的工夫东张西望，猜想接下来会怎样。'], ['见之则', '追着一只揣着怀表的白兔，掉进奇境。']], src: '出《爱丽丝漫游奇境》第一章 · 刘易斯·卡罗尔', stamp: '奇境' },
    voice: 'clock', hover: 0.42, drift: true, hole: true, acts: ['drink', 'eat'], props: true,
    headC: [0.0, 0.1, 0.01], restAz: 0, pitchAxis: [-1, 0, 0], yaw: [-0.5, 0.5], pitch: [-0.2, 0.2],
    scenery: 'none',
    glsl: /* glsl */`
      float headW(vec3 m){ return smoothstep(0.056, 0.074, m.y) * (1.0 - smoothstep(0.046, 0.066, abs(m.x))); }
      const vec3 NECK = vec3(0.0, 0.062, 0.0);
      float earW(vec3 m){ return 0.0; }
      vec3 earPivot(vec3 m){ return m; }
      float earDir(vec3 m){ return 0.0; }
      vec3 swing(vec3 o, vec2 piv, float a){ vec2 d = o.xy - piv; o.xy = piv + mat2(cos(a), sin(a), -sin(a), cos(a)) * d; return o; }
      vec3 bodyMove(vec3 m){
        vec3 o = m;
        float r = length(m.xz), th = atan(m.z, m.x);
        // 裙摆：下落时鼓起、翻动
        float ws = (1.0 - smoothstep(-0.05, 0.03, m.y)) * step(-0.072, m.y) * smoothstep(0.012, 0.035, r);
        o.y += uSway * ws * 0.006 * sin(3.0 * th + uTime * 2.4);
        o.xz += normalize(m.xz + vec2(1e-5)) * uSway * ws * 0.004 * sin(5.0 * th - uTime * 3.1);
        // 头发：随风飘
        float wh = smoothstep(0.07, 0.135, m.y) * 0.6 + smoothstep(0.03, 0.05, abs(m.x)) * step(0.055, m.y);
        o.x += uSway * wh * 0.003 * sin(uTime * 1.7 + m.y * 60.0);
        o.z += uSway * wh * 0.003 * cos(uTime * 1.3 + m.x * 50.0);
        // 双臂：轻轻划动，像在空中保持平衡
        float wl = (1.0 - smoothstep(-0.06, -0.034, m.x)) * step(0.028, m.y) * (1.0 - smoothstep(0.03, 0.05, abs(m.z)));
        wl *= smoothstep(0.0, 0.05, length(m.xy - vec2(-0.034, 0.062)));
        o = swing(o, vec2(-0.034, 0.062), uSway * wl * 0.13 * sin(uTime * 1.1));
        float wr = smoothstep(0.034, 0.06, m.x) * step(0.012, m.y) * step(m.y, 0.06) * (1.0 - smoothstep(0.03, 0.05, abs(m.z)));
        wr *= smoothstep(0.0, 0.05, length(m.xy - vec2(0.034, 0.045)));
        o = swing(o, vec2(0.034, 0.045), uSway * wr * 0.13 * sin(uTime * 1.1 + 1.7));
        // 双腿：慢慢蹬
        float wg = 1.0 - smoothstep(-0.075, -0.055, m.y);
        o = swing(o, vec2(-0.015, -0.045), uSway * wg * 0.07 * sin(uTime * 1.4 + m.x * 80.0));
        return o;
      }`,
  },
];

// 第三本：小王子（圣埃克苏佩里 1943）。一页两个角色：小王子与狐狸，一起出册
const FOX2 = {
  id: 'fox2', model: 'm5c', fitW: 0.9, slot: [0.72, 0.6325, 0.55],
  name: '狐狸', voice: 'yip', ears: true,
  headC: [-0.06, 0.09, 0.0], restAz: 0.5, pitchAxis: [-1, 0, 0], yaw: [-0.55, 0.35], pitch: [-0.15, 0.15],
  glsl: /* glsl */`
    float headW(vec3 m){ return smoothstep(0.02, 0.045, m.y); }
    const vec3 NECK = vec3(-0.06, 0.025, 0.0);
    float earW(vec3 m){ return headW(m) * smoothstep(0.095, 0.125, m.y); }
    vec3 earPivot(vec3 m){ return vec3(m.x, 0.105, m.z); }
    float earDir(vec3 m){ return sign(m.x + 0.07); }
    vec3 bodyMove(vec3 m){
      vec3 o = m;
      // 尾巴：铺在地上，左右轻甩
      vec2 root = vec2(0.03, -0.06);
      float tw = smoothstep(0.045, 0.08, m.x) * (1.0 - smoothstep(-0.075, -0.05, m.y)) * smoothstep(0.01, 0.08, length(m.xz - root));
      float a = uSway * tw * 0.18 * sin(uTime * 1.5);
      o.xz = root + mat2(cos(a), sin(a), -sin(a), cos(a)) * (m.xz - root);
      o.y += uSway * tw * 0.006 * max(0.0, sin(uTime * 1.5 + 1.0));
      vec3 chest = vec3(-0.06, -0.04, 0.02);
      float bw = (1.0 - smoothstep(0.02, 0.07, length(m - chest))) * (1.0 - headW(m));
      o += normalize(m - chest + vec3(1e-5)) * (0.5 + 0.5 * sin(uTime * 1.7)) * 0.0016 * uLife * bw;
      return o;
    }`,
};
const PRINCE = [
  {
    id: 'prince', model: 'm6c', plate: 'plate_prince.jpg', fitW: 0.9, slot: [0.30, 0.60, 0.62], style: 'west', companions: [FOX2],
    name: '小王子和狐狸', pageName: 'Le Petit Prince', pageSub: 'Chapitre XXI — Le renard', nums: ['72', '73'],
    brand: '第二十一章 · 狐狸 · 插图一',
    chapter: 'CHAPITRE XXI', title: '— Apprivoise-moi !',
    paras: [
      "Tu n'es encore pour moi qu'un petit garçon tout semblable à cent mille petits garçons. Et je n'ai pas besoin de toi. Et tu n'as pas besoin de moi non plus. Je ne suis pour toi qu'un renard semblable à cent mille renards. Mais, si tu m'apprivoises, nous aurons besoin l'un de l'autre. Tu seras pour moi unique au monde. Je serai pour toi unique au monde...",
      "« On ne voit bien qu'avec le cœur. L'essentiel est invisible pour les yeux. »",
    ],
    gloss: '真正重要的东西用眼睛是看不见的', glossKey: 'invisible',
    note: { h: '小王子与狐狸', rows: [['所在', '一片麦田边。'], ['其事', '狐狸请小王子“驯养”它：每天同一个时候来，坐得一天比一天近。'], ['见之则', '从此麦子的金色，会让狐狸想起小王子的头发。']], src: '出《小王子》第二十一章 · 圣埃克苏佩里', stamp: '驯养' },
    voice: 'bells', acts: ['wind'],
    headC: [0.0, 0.08, 0.0], restAz: 0, pitchAxis: [-1, 0, 0], yaw: [-0.45, 0.55], pitch: [-0.15, 0.2],
    scenery: 'wheat', world: 'xw_world.jpg', worldTint: 0xfff4e0,
    glsl: /* glsl */`
      float headW(vec3 m){ return smoothstep(0.024, 0.046, m.y) * (1.0 - smoothstep(0.045, 0.06, m.x) * (1.0 - smoothstep(0.04, 0.055, m.y))); }
      const vec3 NECK = vec3(0.0, 0.028, -0.005);
      float earW(vec3 m){ return 0.0; }
      vec3 earPivot(vec3 m){ return m; }
      float earDir(vec3 m){ return 0.0; }
      vec3 bodyMove(vec3 m){
        vec3 o = m;
        // 围巾的末梢：被风吹着
        float ws = smoothstep(0.04, 0.075, m.x) * step(-0.035, m.y) * (1.0 - smoothstep(0.035, 0.045, m.y));
        o.y += uSway * ws * 0.004 * sin(uTime * 3.2 - m.x * 140.0);
        o.z += uSway * ws * 0.004 * cos(uTime * 2.7 - m.x * 120.0);
        // 头发
        float wh = smoothstep(0.095, 0.13, m.y);
        o.x += uSway * wh * 0.0015 * sin(uTime * 1.6 + m.z * 90.0);
        vec3 chest = vec3(0.0, -0.015, 0.0);
        float bw = (1.0 - smoothstep(0.01, 0.05, length(m - chest))) * (1.0 - headW(m));
        o += normalize(m - chest + vec3(1e-5)) * (0.5 + 0.5 * sin(uTime * 1.5)) * 0.001 * uLife * bw;
        return o;
      }`,
  },
];
// 小王子的封面：夜蓝布、烫金小行星与星（原创纹样）
function princeCoverCanvas(clothImg) {
  const W = 1049, H = 1426; const [c, g] = mk(W, H);
  g.drawImage(clothImg, 0, 0, W, H);
  g.globalCompositeOperation = 'multiply'; g.fillStyle = '#6f7fae'; g.fillRect(0, 0, W, H); g.globalCompositeOperation = 'source-over';
  const edge = g.createRadialGradient(W / 2, H / 2, H * .3, W / 2, H / 2, H * .75); edge.addColorStop(0, 'rgba(0,0,0,0)'); edge.addColorStop(1, 'rgba(0,0,20,.35)');
  g.fillStyle = edge; g.fillRect(0, 0, W, H);
  const gold = g.createLinearGradient(0, 0, W, H); gold.addColorStop(0, '#ecd391'); gold.addColorStop(.5, '#bf9246'); gold.addColorStop(1, '#e4c57f');
  g.strokeStyle = gold; g.fillStyle = gold; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 3; g.strokeRect(70, 70, W - 140, H - 140);
  g.font = `italic 46px ${WSERIF}`; g.fillText('Le', W / 2, 230);
  g.font = `600 92px ${WSERIF}`; g.fillText('PETIT PRINCE', W / 2, 320);
  g.lineWidth = 1.5; g.beginPath(); g.moveTo(W / 2 - 120, 390); g.lineTo(W / 2 + 120, 390); g.stroke();
  // 小行星：一株玫瑰、两座火山
  const px = W / 2, py = 820, R = 175;
  g.lineWidth = 6; g.beginPath(); g.arc(px, py, R, 0, 7); g.stroke();
  g.lineWidth = 2; for (let i = 0; i < 7; i++) { const a = -2.6 + i * .5; g.beginPath(); g.arc(px + Math.cos(a) * R * .55, py + Math.sin(a) * R * .55 + 40, 10 + (i % 3) * 6, 0, 7); g.stroke(); }
  const top = (a, dy = 0) => [px + Math.cos(a) * (R + dy), py + Math.sin(a) * (R + dy)];
  let [x, y] = top(-1.95); g.lineWidth = 4; g.beginPath(); g.moveTo(x - 22, y + 6); g.lineTo(x - 6, y - 30); g.lineTo(x + 8, y - 30); g.lineTo(x + 22, y + 8); g.stroke(); // 火山
  [x, y] = top(-1.25); g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 6, y - 40, x + 2, y - 74); g.stroke(); // 玫瑰茎
  g.beginPath(); g.arc(x + 2, y - 88, 15, 0, 7); g.fill();
  g.beginPath(); g.moveTo(x + 2, y - 50); g.quadraticCurveTo(x + 26, y - 60, x + 30, y - 44); g.stroke();
  const star = (sx, sy, r) => { g.beginPath(); for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5 - Math.PI / 2, rr = i % 2 ? r * .42 : r; g.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr); } g.closePath(); g.fill(); };
  [[230, 560, 16], [820, 520, 22], [760, 1090, 12], [270, 1060, 18], [900, 760, 10], [160, 790, 9], [600, 520, 8]].forEach((a) => star(...a));
  g.font = `600 34px ${WSERIF}`; g.fillText('ANTOINE DE SAINT-EXUPÉRY', W / 2, 1230);
  return c;
}

// 西式书页
const WSERIF = '"EB Garamond","Cormorant Garamond",Georgia,"Times New Roman",serif';
function westLeftCanvas(b, seed) {
  const [c, g] = mk(PAGE_PX, PAGE_PY);
  paintPaper(g, PAGE_PX, PAGE_PY, seed, '#efe6d0');
  const { cx, cy, s } = plateRect();
  g.strokeStyle = 'rgba(60,40,30,.75)'; g.lineWidth = 2.2; g.strokeRect(cx - s / 2 - 16, cy - s / 2 - 16, s + 32, s + 32);
  g.lineWidth = 1; g.strokeRect(cx - s / 2 - 8, cy - s / 2 - 8, s + 16, s + 16);
  const ty = cy + s / 2 + 92;
  g.fillStyle = '#2b211b'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `italic 60px ${WSERIF}`; g.fillText(b.pageName, cx, ty);
  g.font = `26px ${WSERIF}`; g.fillStyle = 'rgba(43,33,27,.7)'; g.fillText(b.pageSub, cx, ty + 54);
  g.font = `24px ${WSERIF}`; g.fillStyle = 'rgba(43,33,27,.55)'; g.fillText(b.nums[0], cx, PAGE_PY - 70);
  return c;
}
function westRightCanvas(b, seed) {
  const [c, g] = mk(PAGE_PX, PAGE_PY);
  paintPaper(g, PAGE_PX, PAGE_PY, seed, '#efe6d0');
  const L = 120, R = PAGE_PX - 110; let y = 210;
  g.fillStyle = '#2b211b'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  if (b.chapter) { g.font = `34px ${WSERIF}`; g.fillText(b.chapter.split('').join(String.fromCharCode(8202)), PAGE_PX / 2, y); } y += 70;
  g.font = `italic 52px ${WSERIF}`; g.fillText(b.title, PAGE_PX / 2, y); y += 40;
  g.strokeStyle = 'rgba(43,33,27,.5)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(PAGE_PX / 2 - 60, y); g.lineTo(PAGE_PX / 2 + 60, y); g.stroke(); y += 80;
  const fs = 40, lh = 58; g.font = `${fs}px ${WSERIF}`; g.textAlign = 'left';
  let glossY = null;
  b.paras.forEach((para, pi) => {
    const cjk = !/\s/.test(para.trim()), sep = cjk ? '' : ' ';
    let words = cjk ? [...para] : para.split(' '), first = true, indent = pi === 0 ? 0 : 44;
    if (cjk) g.font = `${fs}px ${SERIF}`;
    if (pi === 0 && !cjk) { // 首字下沉
      const cap = words[0][0]; words[0] = words[0].slice(1);
      g.font = `118px ${WSERIF}`; g.fillStyle = '#7a2a1e'; g.fillText(cap, L - 4, y + 64); g.font = `${fs}px ${WSERIF}`; g.fillStyle = '#2b211b';
    }
    let lineNo = 0;
    while (words.length) {
      const capPad = pi === 0 && lineNo < 2 && !cjk ? 92 : 0;
      const x0 = L + capPad + (first ? indent : 0), maxW = R - x0;
      const line = []; let w = 0;
      while (words.length) {
        const ww = g.measureText((line.length ? sep : '') + words[0]).width;
        if (w + ww > maxW && line.length) break;
        line.push(words.shift()); w += ww;
      }
      const last = !words.length;
      if (line.join(sep).includes(b.glossKey || 'book-shelves') && glossY === null) glossY = y;
      if (last || cjk) g.fillText(line.join(sep), x0, y);
      else { // 两端对齐
        const nat = line.reduce((a, t) => a + g.measureText(t).width, 0), gap = (maxW - nat) / Math.max(1, line.length - 1);
        let x = x0; line.forEach((t) => { g.fillText(t, x, y); x += g.measureText(t).width + gap; });
      }
      y += lh; first = false; lineNo++;
    }
    y += 18;
  });
  // 页边的朱笔批注
  if (b.gloss && glossY !== null) {
    g.save(); g.fillStyle = 'rgba(160,40,30,.8)'; g.font = `22px ${BRUSH}`; g.textAlign = 'center';
    [...b.gloss].forEach((ch, i) => g.fillText(ch, R + 52, glossY - 20 + i * 24));
    g.restore();
  }
  g.font = `24px ${WSERIF}`; g.fillStyle = 'rgba(43,33,27,.55)'; g.textAlign = 'center'; g.fillText(b.nums[1], PAGE_PX / 2, PAGE_PY - 70);
  return c;
}
// 维多利亚式布面精装封面：红布、烫金双线框、怀表纹样（原创纹样）
function aliceCoverCanvas(clothImg) {
  const W = 1049, H = 1426; const [c, g] = mk(W, H);
  g.drawImage(clothImg, 0, 0, W, H);
  // 把靛蓝布纹染成酒红
  g.globalCompositeOperation = 'color'; g.fillStyle = '#7d2622'; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'multiply'; g.fillStyle = '#c9605a'; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'source-over';
  const edge = g.createRadialGradient(W / 2, H / 2, H * .3, W / 2, H / 2, H * .75); edge.addColorStop(0, 'rgba(0,0,0,0)'); edge.addColorStop(1, 'rgba(20,0,0,.35)');
  g.fillStyle = edge; g.fillRect(0, 0, W, H);
  const gold = g.createLinearGradient(0, 0, W, H); gold.addColorStop(0, '#e9cf8a'); gold.addColorStop(.5, '#b8893e'); gold.addColorStop(1, '#e0c27a');
  g.strokeStyle = gold; g.fillStyle = gold;
  g.lineWidth = 6; g.strokeRect(54, 54, W - 108, H - 108); g.lineWidth = 2; g.strokeRect(76, 76, W - 152, H - 152);
  for (const [x, y] of [[76, 76], [W - 76, 76], [76, H - 76], [W - 76, H - 76]]) { g.beginPath(); g.arc(x, y, 14, 0, 7); g.fill(); }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `600 64px ${WSERIF}`;
  ["ALICE'S", 'ADVENTURES', 'IN', 'WONDERLAND'].forEach((t, i) => { g.font = i === 2 ? `italic 48px ${WSERIF}` : `600 ${i === 0 ? 76 : 70}px ${WSERIF}`; g.fillText(t, W / 2, 250 + i * 98 - (i > 2 ? 10 : 0)); });
  // 怀表
  const cx = W / 2, cy = 860, R = 150;
  g.lineWidth = 7; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke();
  g.lineWidth = 2.5; g.beginPath(); g.arc(cx, cy, R - 18, 0, 7); g.stroke();
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; g.beginPath(); g.moveTo(cx + Math.sin(a) * (R - 26), cy - Math.cos(a) * (R - 26)); g.lineTo(cx + Math.sin(a) * (R - (i % 3 ? 40 : 52)), cy - Math.cos(a) * (R - (i % 3 ? 40 : 52))); g.stroke(); }
  g.lineWidth = 6; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx - 52, cy - 52); g.stroke();
  g.lineWidth = 4; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + 18, cy - 96); g.stroke();
  g.beginPath(); g.arc(cx, cy, 9, 0, 7); g.fill();
  g.lineWidth = 6; g.beginPath(); g.arc(cx, cy - R - 26, 22, 0, 7); g.stroke(); g.fillRect(cx - 10, cy - R - 8, 20, 10);
  g.lineWidth = 3; g.beginPath(); // 表链
  for (let i = 0; i <= 14; i++) { const t = i / 14, x = cx + 22 + t * 240, y = cy - R - 26 + Math.sin(t * Math.PI) * 120; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
  g.font = `600 40px ${WSERIF}`; g.fillText('LEWIS CARROLL', W / 2, 1180);
  return c;
}
function tintCanvas(img, color, mul) {
  const [c, g] = mk(img.width, img.height); g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'color'; g.fillStyle = color; g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'multiply'; g.fillStyle = mul; g.fillRect(0, 0, c.width, c.height);
  return c;
}

/* ------------------------------------------------------------------ 页面纹理 */
const PAGE_PX = 1024, PAGE_PY = Math.round(1024 * PAGE_D / PAGE_W);
const w2px = PAGE_PX / PAGE_W;
const plateRect = () => {
  const cx = (PLATE_X + GAP / 2 + PAGE_W) * w2px, cy = (PLATE_Z + PAGE_D / 2) * w2px, s = PLATE * w2px;
  return { cx, cy, s };
};
// 左页：版框 + 图题（图版本身另作一层，可鼓起）
function leftPageCanvas(b, seed) {
  if (b.style === 'west') return westLeftCanvas(b, seed);
  const [c, g] = mk(PAGE_PX, PAGE_PY);
  paintPaper(g, PAGE_PX, PAGE_PY, seed);
  const { cx, cy, s } = plateRect();
  g.strokeStyle = 'rgba(40,30,22,.78)'; g.lineWidth = 6; g.strokeRect(cx - s / 2 - 22, cy - s / 2 - 22, s + 44, s + 44);
  g.lineWidth = 1.6; g.strokeRect(cx - s / 2 - 11, cy - s / 2 - 11, s + 22, s + 22);
  const ty = cy + s / 2 + 92;
  g.fillStyle = '#2a2420'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `600 46px ${SERIF}`; g.fillText(b.pageName, cx, ty);
  const nameW = g.measureText(b.pageName).width;
  g.font = `26px ${SERIF}`; g.fillStyle = 'rgba(42,36,32,.72)'; g.fillText(b.pageSub, cx, ty + 56);
  const sx = cx + Math.max(110, nameW / 2 + 40);
  g.fillStyle = 'rgba(178,58,42,.88)'; g.fillRect(sx, ty - 30, 48, 48);
  g.fillStyle = '#f6e6d2'; g.font = `24px ${BRUSH}`; g.fillText('圖', sx + 24, ty - 6);
  g.fillStyle = 'rgba(42,36,32,.5)'; g.font = `22px ${SERIF}`; g.fillText(b.nums[0], 70, PAGE_PY - 60);
  return c;
}
// 右页：竖排经文（自动分行；圈点关键句）
function rightPageCanvas(b, seed) {
  if (b.style === 'west') return westRightCanvas(b, seed);
  const [c, g] = mk(PAGE_PX, PAGE_PY);
  paintPaper(g, PAGE_PX, PAGE_PY, seed);
  const L = 110, R = PAGE_PX - 100, T = 150, B = PAGE_PY - 190;
  g.strokeStyle = 'rgba(150,40,30,.55)'; g.lineWidth = 5; g.strokeRect(L - 14, T - 14, R - L + 28, B - T + 28);
  g.lineWidth = 1.4; g.strokeRect(L, T, R - L, B - T);
  const cols = 10, rows = 12, cw = (R - L) / cols;
  g.strokeStyle = 'rgba(150,40,30,.32)'; g.lineWidth = 1.2;
  for (let i = 1; i < cols; i++) { g.beginPath(); g.moveTo(L + i * cw, T); g.lineTo(L + i * cw, B); g.stroke(); }
  const fs = 54, lh = (B - T - 40) / rows;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const put = (ch, col, row, style) => {
    g.font = style.font; g.fillStyle = style.color;
    g.fillText(ch, R - cw * (col + .5), T + 30 + lh * (row + .5));
  };
  const dot = (col, row) => { g.fillStyle = 'rgba(178,58,42,.85)'; g.beginPath(); g.arc(R - cw * (col + .5) + fs * .62, T + 30 + lh * (row + .5) + 8, 4.5, 0, 7); g.fill(); };
  const H = { font: `900 ${fs}px ${SERIF}`, color: '#2a2420' }, N = { font: `${fs}px ${SERIF}`, color: '#2a2420' };
  const G = { font: `${fs * .8}px ${SERIF}`, color: 'rgba(42,36,32,.66)' }, F = { font: `${fs}px ${SERIF}`, color: 'rgba(42,36,32,.6)' };
  [...b.header].forEach((ch, j) => put(ch, 0, j, H));
  const chars = [...b.body], mi = b.body.indexOf(b.mark), ml = [...b.mark].length;
  let col = 1;
  chars.forEach((ch, i) => {
    const cc = 1 + Math.floor(i / rows), rr = i % rows; col = cc;
    put(ch, cc, rr, N);
    if (mi >= 0 && i >= mi && i < mi + ml) dot(cc, rr);
  });
  if (b.gloss) { col += 1; [...b.gloss].forEach((ch, j) => put(ch, col + Math.floor(j / rows), j % rows, G)); col += Math.floor(([...b.gloss].length - 1) / rows); }
  [...b.footer].forEach((ch, j) => put(ch, cols - 1, j, F));
  g.fillStyle = 'rgba(42,36,32,.5)'; g.font = `22px ${SERIF}`; g.textAlign = 'center'; g.fillText(b.nums[1], PAGE_PX - 70, PAGE_PY - 60);
  return c;
}
// 翻页时纸背所见：左页 + 图版合成
function leftCompositeCanvas(left, plateImg) {
  const [c, g] = mk(PAGE_PX, PAGE_PY);
  g.drawImage(left, 0, 0);
  const { cx, cy, s } = plateRect();
  g.drawImage(plateImg, cx - s / 2, cy - s / 2, s, s);
  return c;
}

/* ------------------------------------------------------------------ 图版（可鼓起，可留白） */
const plateUniforms = {
  uBulge: { value: 0 }, uOut: { value: 0 }, uBg: { value: new THREE.Color() }, uTime: { value: 0 },
};
function makePlate(tex) {
  const geo = new THREE.PlaneGeometry(PLATE, PLATE, 96, 96); geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: .92, color: 0xe9e0cf });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, plateUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uBulge; uniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec2 q = position.xz / ${(PLATE / 2).toFixed(4)};
        float r2 = dot(q * vec2(1.0, 1.15) - vec2(0.0, 0.05), q * vec2(1.0, 1.15) - vec2(0.0, 0.05));
        float edge = (1.0 - smoothstep(0.86, 1.0, abs(q.x))) * (1.0 - smoothstep(0.86, 1.0, abs(q.y)));
        transformed.y += uBulge * 0.32 * exp(-r2 * 2.6) * edge * (1.0 + 0.04 * sin(uTime * 9.0 + q.x * 6.0));`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uOut; uniform vec3 uBg;')
      .replace('#include <map_fragment>', `
        vec4 sampledDiffuseColor = texture2D( map, vMapUv );
        float keep = mix(1.0, 0.13, uOut); // 出册后只留下淡淡的墨痕
        sampledDiffuseColor.rgb = mix(uBg, sampledDiffuseColor.rgb, keep);
        diffuseColor *= sampledDiffuseColor;`);
  };
  mat.customProgramCacheKey = () => 'plate';
  const m = new THREE.Mesh(geo, mat);
  m.position.set(PLATE_X, PT + 0.0015, PLATE_Z);
  m.receiveShadow = true;
  return m;
}

/* ------------------------------------------------------------------ 纸景 */
function cutPaper(draw, w, h, seed, opts) {
  const [c, g] = mk(w, h);
  draw(g, w, h, rand(seed), opts || {});
  return canvasTex(c);
}
function mountainLayer(g, w, h, r, o) {
  const top = o.top || '#5d8a83', mid = o.mid || '#8fae98', bot = o.bot || '#e3d8b8';
  const pts = []; const n = o.n || 9;
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * w; const peak = i % 2 ? (o.hi ?? .12) + r() * .25 : (o.lo ?? .45) + r() * .22;
    pts.push([x, h * peak]);
  }
  const path = () => {
    g.beginPath(); g.moveTo(0, h); g.lineTo(0, pts[0][1]);
    for (let i = 0; i < n; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      if (o.sharp) g.lineTo(x0 + (x1 - x0) * (.4 + r() * .2), Math.min(y0, y1) - 6 - r() * 20), g.lineTo(x1, y1);
      else g.quadraticCurveTo(x0 + (x1 - x0) * .5 + (r() - .5) * 20, Math.min(y0, y1) - 18, x1, y1);
    }
    g.lineTo(w, h); g.closePath();
  };
  const inset = () => { g.save(); g.translate(w * .015, h * .03); g.scale(.97, .97); path(); g.restore(); };
  path(); g.fillStyle = '#efe4cc'; g.fill();
  inset();
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, top); gr.addColorStop(.55, mid); gr.addColorStop(1, bot);
  g.fillStyle = gr; g.fill();
  g.strokeStyle = o.cun || 'rgba(40,52,46,.55)'; g.lineWidth = 2; // 皴法
  for (let i = 0; i < 46; i++) {
    const x = r() * w, y = h * (.25 + r() * .55);
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 14, y + 16, x + 6 + r() * 10, y + 34 + r() * 20); g.stroke();
  }
  g.strokeStyle = o.ink || 'rgba(30,40,36,.8)'; g.lineWidth = 3;
  inset(); g.stroke();
  if (o.dots) {
    g.fillStyle = o.dots;
    for (let i = 0; i < (o.dotN || 7); i++) { g.beginPath(); g.arc(r() * w, h * (.5 + r() * .35), 4 + r() * 5, 0, 7); g.fill(); }
  }
}
function cloudLayer(g, w, h, r, o) {
  const fill = o.fill || '#e9cfa4', line = o.line || 'rgba(178,58,42,.85)';
  const curl = (x, y, s) => {
    g.beginPath();
    g.arc(x, y, s, Math.PI, 0); g.arc(x + s * 1.6, y, s * .6, Math.PI, 0);
    g.arc(x + s * 2.7, y + s * .1, s * .5, Math.PI * 1.1, Math.PI * 2.2);
    g.lineTo(x + s * 3.1, y + s * .55); g.lineTo(x - s, y + s * .55); g.closePath();
  };
  const blobs = o.blobs || [[.05, .30, .10], [.40, .20, .12], [.72, .36, .085], [.20, .78, .07], [.62, .80, .06]];
  for (const [bx, by, bs] of blobs) {
    const x = bx * w, y = by * h, s = bs * w;
    g.save(); g.lineJoin = 'round';
    curl(x, y, s); g.fillStyle = '#efe4cc'; g.lineWidth = 14; g.strokeStyle = '#efe4cc'; g.stroke(); g.fill();
    curl(x, y, s); g.fillStyle = fill; g.fill();
    g.strokeStyle = line; g.lineWidth = 3.2; g.stroke();
    g.beginPath(); g.arc(x, y, s * .55, Math.PI * .9, Math.PI * 2.4); g.stroke();
    g.beginPath(); g.arc(x + s * 1.6, y, s * .3, Math.PI * .9, Math.PI * 2.3); g.stroke();
    g.restore();
  }
  if (o.rain) { // 乃得大雨
    g.strokeStyle = 'rgba(70,90,120,.55)'; g.lineWidth = 2;
    for (let i = 0; i < 70; i++) { const x = r() * w, y = h * (.45 + r() * .5); g.beginPath(); g.moveTo(x, y); g.lineTo(x - 8, y + 26 + r() * 20); g.stroke(); }
  }
}
function bankLayer(g, w, h, r, o) {
  const bank = (x0, x1, flip) => {
    g.beginPath(); g.moveTo(x0, h);
    const n = 6;
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = x0 + (x1 - x0) * t;
      const hump = Math.sin((flip ? 1 - t : t) * Math.PI * .9 + .2);
      g.lineTo(x, h - h * (.25 + .55 * hump * (flip ? t : 1 - t) + .15 * hump) + (o.jag ? (r() - .5) * 18 : 0));
    }
    g.lineTo(x1, h); g.closePath();
  };
  for (const [a, b, f] of [[0, w * .3, false], [w * .7, w, true]]) {
    bank(a, b, f); g.fillStyle = '#efe4cc'; g.lineJoin = 'round'; g.lineWidth = 14; g.strokeStyle = '#efe4cc'; g.stroke(); g.fill();
    bank(a, b, f); const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, o.top || '#7f9c7a'); gr.addColorStop(1, o.bot || '#cfc9a2');
    g.fillStyle = gr; g.fill(); g.strokeStyle = 'rgba(36,44,34,.85)'; g.lineWidth = 3; g.stroke();
    if (o.grass !== false) {
      g.strokeStyle = 'rgba(46,70,48,.9)'; g.lineWidth = 2.2;
      for (let i = 0; i < 14; i++) {
        const x = a + 20 + r() * (b - a - 40), y = h * (.55 + r() * .3);
        g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + (r() - .5) * 10, y - 18, x + (r() - .3) * 16, y - 26 - r() * 14); g.stroke();
      }
    } else {
      g.strokeStyle = 'rgba(40,30,22,.6)'; g.lineWidth = 2; // 石纹
      for (let i = 0; i < 10; i++) { const x = a + 20 + r() * (b - a - 40), y = h * (.45 + r() * .4); g.beginPath(); g.moveTo(x, y); g.lineTo(x + 10 + r() * 14, y + 8); g.stroke(); }
    }
  }
}
function waveLayer(g, w, h, r) { // 海水江崖式的浪
  const crest = (x, y, s) => {
    g.beginPath(); g.moveTo(x - s * 1.6, y + s);
    g.quadraticCurveTo(x - s, y - s * .2, x, y - s * .6);
    g.quadraticCurveTo(x + s * .9, y - s * .9, x + s * .6, y + s * .1);
    g.quadraticCurveTo(x + s * .3, y - s * .25, x + s * .05, y + s * .1);
    g.quadraticCurveTo(x + s * .8, y + s * .5, x + s * 1.6, y + s);
    g.closePath();
  };
  const xs = [.06, .2, .8, .94];
  for (const bx of xs) {
    const x = bx * w, y = h * .55, s = h * .38;
    crest(x, y, s); g.fillStyle = '#efe4cc'; g.lineWidth = 12; g.strokeStyle = '#efe4cc'; g.lineJoin = 'round'; g.stroke(); g.fill();
    crest(x, y, s); const gr = g.createLinearGradient(0, y - s, 0, h); gr.addColorStop(0, '#9fb7c4'); gr.addColorStop(1, '#5f7f96');
    g.fillStyle = gr; g.fill(); g.strokeStyle = 'rgba(30,48,66,.85)'; g.lineWidth = 3; g.stroke();
    g.strokeStyle = 'rgba(240,236,224,.85)'; g.lineWidth = 2;
    for (let k = 1; k < 4; k++) { g.beginPath(); g.arc(x + s * .3, y - s * .1, s * .12 * k, Math.PI * .9, Math.PI * 1.9); g.stroke(); }
  }
  g.fillStyle = '#5f7f96'; // 浪底相连
  g.fillRect(0, h * .9, w * .3, h * .1); g.fillRect(w * .7, h * .9, w * .3, h * .1);
}
function wheatLayer(g, w, h, r) { // 金色麦田
  g.beginPath(); g.moveTo(0, h);
  for (let x = 0; x <= w; x += 32) g.lineTo(x, h * (.32 + .1 * Math.sin(x * .012) + r() * .05));
  g.lineTo(w, h); g.closePath();
  g.fillStyle = '#efe4cc'; g.lineWidth = 12; g.strokeStyle = '#efe4cc'; g.lineJoin = 'round'; g.stroke(); g.fill();
  const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#e2b850'); gr.addColorStop(1, '#c79a3c');
  g.fillStyle = gr; g.fill(); g.strokeStyle = 'rgba(110,76,30,.75)'; g.lineWidth = 2.5; g.stroke();
  for (let i = 0; i < 160; i++) { // 麦穗
    const x = r() * w, y = h * (.38 + r() * .55), l = 18 + r() * 22, a = -Math.PI / 2 + (r() - .5) * .5;
    g.strokeStyle = `rgba(${120 + r() * 40},${84 + r() * 30},30,.7)`; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    g.fillStyle = 'rgba(245,214,120,.9)';
    for (let k = 0; k < 4; k++) { g.beginPath(); g.ellipse(x + Math.cos(a) * (l - k * 4), y + Math.sin(a) * (l - k * 4), 2.2, 4.4, a + Math.PI / 2, 0, 7); g.fill(); }
  }
}
function skyLayer(g, w, h, r) { // 远处的天：一颗小行星和几颗星
  g.beginPath(); g.moveTo(0, h); g.lineTo(0, h * .45);
  g.bezierCurveTo(w * .2, h * .05, w * .8, h * .05, w, h * .45); g.lineTo(w, h); g.closePath();
  g.fillStyle = '#efe4cc'; g.lineWidth = 14; g.strokeStyle = '#efe4cc'; g.stroke(); g.fill();
  const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#5d6f9e'); gr.addColorStop(.7, '#a9b7cf'); gr.addColorStop(1, '#e6dcc4');
  g.fillStyle = gr; g.fill(); g.strokeStyle = 'rgba(30,40,70,.7)'; g.lineWidth = 3; g.stroke();
  g.fillStyle = 'rgba(250,232,170,.95)';
  for (let i = 0; i < 26; i++) { const x = w * (.1 + r() * .8), y = h * (.18 + r() * .35), s = 2 + r() * 4; g.beginPath(); for (let k = 0; k < 10; k++) { const a = k * Math.PI / 5 - Math.PI / 2, rr = k % 2 ? s * .45 : s; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.fill(); }
  const px = w * .74, py = h * .3, R = h * .085; // 小行星
  g.fillStyle = '#d9b77a'; g.beginPath(); g.arc(px, py, R, 0, 7); g.fill(); g.strokeStyle = 'rgba(60,40,20,.8)'; g.lineWidth = 2.4; g.stroke();
  g.fillStyle = '#b33a2c'; g.beginPath(); g.arc(px + R * .1, py - R - 9, 5, 0, 7); g.fill();
  g.beginPath(); g.moveTo(px + R * .1, py - R); g.lineTo(px + R * .1, py - R - 6); g.stroke();
}
const SCENE_IMG = {}; // 手绘纸景图（启动时载入）
const imgLayer = (name) => { const t = imgTex(SCENE_IMG[name]); return t; };
const SCENERY = {
  none: () => [],
  wheat: (s) => SCENE_IMG.xw_sky ? [ // 小王子：星空穹顶、麦田、花坡（手绘分层）
    [imgLayer('xw_sky'), 3.2, 1.47, -1.25, 0.15, 0.06],
    [imgLayer('xw_wheat'), 3.0, 0.62, -0.75, 0.3],
    [imgLayer('xw_bank'), 2.6, 0.53, 0.08, 0.45, 0.4],
  ] : [
    [cutPaper(skyLayer, 1024, 640, 41 + s), 2.4, 1.55, -1.25, 0.15],
    [cutPaper(wheatLayer, 1024, 360, 43 + s), 2.35, 0.75, -0.75, 0.3],
    [cutPaper(bankLayer, 1024, 200, 47 + s, { top: '#9aa36a', bot: '#d6c99a' }), 2.3, 0.34, 0.08, 0.45],
  ],
  qingqiu: (s) => SCENE_IMG.qq_far ? [ // 青丘之山（手绘分层）
    [imgLayer('qq_far'), 5.0, 1.44, -1.75, 0.12],
    [imgLayer('qq_mid'), 3.5, 1.66, -0.95, 0.28],
    [imgLayer('qq_front'), 3.0, 0.48, 0.12, 0.42],
  ] : [
    [cutPaper(mountainLayer, 1024, 820, 4 + s, { dots: 'rgba(245,240,225,.85)' }), 2.4, 1.95, -1.6, 0.15],
    [cutPaper(cloudLayer, 1024, 560, 9 + s), 2.35, 1.3, -1.1, 0.3],
    [cutPaper(bankLayer, 1024, 200, 2 + s), 2.3, 0.36, 0.08, 0.45],
  ],
  zhange: (s) => SCENE_IMG.zg_far ? [ // 章莪之山：无草木，多瑶碧（手绘分层；石头不随风摆）
    [imgLayer('zg_far'), 5.0, 1.64, -1.75, 0.12, 0],
    [imgLayer('zg_mid'), 3.5, 1.67, -0.95, 0.28, 0],
    [imgLayer('zg_front'), 3.0, 0.44, 0.12, 0.42, 0],
  ] : [
    [cutPaper(mountainLayer, 1024, 820, 14 + s, { top: '#4f3a28', mid: '#76583c', bot: '#ad916a', ink: 'rgba(52,40,30,.9)', cun: 'rgba(50,36,24,.55)', dots: 'rgba(60,150,140,.95)', dotN: 14, n: 7, hi: .1, lo: .4 }), 2.4, 1.75, -1.55, 0.15],
    [cutPaper(mountainLayer, 1024, 520, 21 + s, { top: '#5e4c3a', mid: '#82694e', bot: '#b9a07c', ink: 'rgba(52,40,30,.85)', cun: 'rgba(50,36,24,.5)', dots: 'rgba(80,165,155,.95)', dotN: 8, sharp: true, n: 11, hi: .3, lo: .6 }), 2.35, 1.0, -1.05, 0.3],
    [cutPaper(bankLayer, 1024, 200, 5 + s, { top: '#6f5c46', bot: '#b49f7e', grass: false, jag: true }), 2.3, 0.36, 0.08, 0.45],
  ],
  dahuang: (s) => SCENE_IMG.yl_far ? [ // 大荒：远山、雨云、浪（手绘分层）
    [imgLayer('yl_far'), 5.0, 0.48, -1.75, 0.12, 0.1],
    [imgLayer('yl_mid'), 3.5, 1.71, -0.95, 0.28, 0.5],
    [imgLayer('yl_front'), 3.0, 0.68, 0.12, 0.42, 0.35],
  ] : [ // 大荒：远山、雨云、浪
    [cutPaper(mountainLayer, 1024, 700, 31 + s, { top: '#6f8796', mid: '#a5b5bc', bot: '#e3ddc8', ink: 'rgba(30,44,58,.75)', cun: 'rgba(30,44,58,.35)', lo: .55, hi: .3 }), 2.4, 1.4, -1.6, 0.15],
    [cutPaper(cloudLayer, 1024, 640, 7 + s, { fill: '#dfe4e2', line: 'rgba(40,62,92,.85)', rain: true, blobs: [[.04, .22, .12], [.42, .14, .14], [.74, .26, .1]] }), 2.4, 1.5, -1.0, 0.3],
    [cutPaper(waveLayer, 1024, 220, 3 + s), 2.3, 0.4, 0.08, 0.45],
  ],
};

/* ================================================================== 兽的骨架（每只一套） */
// pivot（以足为折线，旋转立起）→ squash（压扁成浮雕）→ fit（缩放对位）→ 模型
const COMMON_GLSL = /* glsl */`
uniform float uTime, uSway, uLife, uEar; uniform vec2 uHead; uniform mat4 uQ; uniform mat3 uQi; uniform vec3 uPitchAxis;
vec3 toModel(vec3 q){ return (uQ * vec4(q, 1.0)).xyz; }
vec3 toQuant(vec3 d){ return uQi * d; }
mat3 rotY(float a){ float c=cos(a), s=sin(a); return mat3(c,0.,-s, 0.,1.,0., s,0.,c); }
mat3 rotZ(float a){ float c=cos(a), s=sin(a); return mat3(c,s,0., -s,c,0., 0.,0.,1.); }
mat3 axisAngle(vec3 a, float t){ float c=cos(t), s=sin(t), C=1.-c;
  return mat3(c+a.x*a.x*C, a.y*a.x*C+a.z*s, a.z*a.x*C-a.y*s,
              a.x*a.y*C-a.z*s, c+a.y*a.y*C, a.z*a.y*C+a.x*s,
              a.x*a.z*C+a.y*s, a.y*a.z*C-a.x*s, c+a.z*a.z*C); }
`;
const DEFORM_GLSL = /* glsl */`
vec3 beastDeform(vec3 m, out mat3 nrm){
  vec3 o = bodyMove(m);
  float ew = earW(m);
  if (ew > 0.0) { vec3 ep = earPivot(m); o = mix(o, ep + rotZ(uEar * 0.22 * earDir(m)) * (o - ep), ew); }
  float hw = headW(m);
  mat3 R = rotY(uHead.x) * axisAngle(uPitchAxis, uHead.y);
  o = mix(o, NECK + R * (o - NECK), hw * uLife);
  nrm = hw * uLife > 0.5 ? R : mat3(1.0);
  return o;
}`;

function makeRig(b) {
  b.glslKey = b.glslKey || b.id;
  b.u = {
    uTime: { value: 0 }, uSway: { value: 0 }, uLife: { value: 0 }, uEar: { value: 0 },
    uHead: { value: new THREE.Vector2() }, uQ: { value: new THREE.Matrix4() }, uQi: { value: new THREE.Matrix3() },
    uPitchAxis: { value: new THREE.Vector3(...b.pitchAxis) },
  };
  b.pivot = new THREE.Group(); b.squash = new THREE.Group(); b.fit = new THREE.Group();
  b.pivot.add(b.squash); b.squash.add(b.fit); b.pivot.visible = false;
  b.meshes = []; b.layers = [];
  b.headNow = new THREE.Vector2();
}
// 给一个网格装上形变着色器；uQ/uQi 按网格各自的节点变换（多网格模型也能对）
function patchBeastMesh(o, b, root) {
  if (!o.userData.qm) { o.userData.qm = o.matrixWorld.clone(); }
  const uQ = { value: o.userData.qm.clone() }, uQi = { value: new THREE.Matrix3().setFromMatrix4(o.userData.qm).invert() };
  const mat = o.material = o.material.clone();
  if (mat.envMapIntensity !== undefined) mat.envMapIntensity = 0.6;
  const glsl = COMMON_GLSL + b.glsl + DEFORM_GLSL;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, b.u, { uQ, uQi });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + glsl)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        mat3 bN; vec3 bM = toModel(position); vec3 bD = beastDeform(bM, bN) - bM;
        objectNormal = normalize(bN * objectNormal);`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed += toQuant(bD);`);
  };
  mat.customProgramCacheKey = () => 'beast-' + b.glslKey;
}
// 风：纸景顶部随风起伏（越高摆得越多），金光从一侧扫过去
function windPatch(mat, b, h, amp) {
  b.wind = b.wind || { uWind: { value: 0 }, uFront: { value: -0.3 }, uGlow: { value: 0 }, uWT: { value: 0 } };
  const U = { ...b.wind, uAmp: { value: amp }, uH: { value: h } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWind, uWT, uAmp, uH;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float hn = clamp(position.y / uH, 0.0, 1.0);
        float wv = sin(position.x * 5.0 - uWT * 5.5) * 0.6 + sin(position.x * 11.0 - uWT * 8.0) * 0.25;
        transformed.z += uAmp * uWind * hn * hn * uH * 0.22 * wv;
        transformed.x += uAmp * uWind * hn * hn * uH * 0.07;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uFront, uGlow, uAmp;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float gm = 1.0 - smoothstep(uFront - 0.22, uFront, vMapUv.x);
        totalEmissiveRadiance += vec3(0.95, 0.55, 0.12) * uGlow * gm * min(uAmp, 1.0) * 0.32;`);
  };
  mat.customProgramCacheKey = () => 'layer-wind';
}
function mountBeast(b, gltf) {
  const root = gltf.scene; root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
  const W = Math.max(size.x, size.y);
  const [scx, scy, ss] = b.slot || [0.5, 0.5, 1];      // 在图版中的格位（中心、占比），与图版渲染一致
  b.k = PLATE * ss * b.fitW / W;
  b.H = size.y * b.k; b.Wd = size.x * b.k;
  b.fit.scale.setScalar(b.k);
  b.fit.position.set(-ctr.x * b.k, -box.min.y * b.k, -ctr.z * b.k);
  b.pivotZ = PLATE_Z + (scy - 0.5) * PLATE + (ctr.y - box.min.y) * b.k;      // 足所在的折线，使平躺时与图版重合
  b.pivotX = PLATE_X + (scx - 0.5) * PLATE;
  b.pivot.position.set(b.pivotX, PT + 0.004, b.pivotZ);
  b.restY = b.fit.position.y; b.fitBase = b.fit.position.clone();
  b.root = root;
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; patchBeastMesh(o, b); b.meshes.push(o); } });
  b.fit.add(root);
  b.vol.group.add(b.pivot);
  // 纸景
  for (const [tex, w, h, dz, delay, wind] of SCENERY[b.scenery || 'none'](0)) {
    const geo = new THREE.PlaneGeometry(w, h, 32, 8); geo.translate(0, h / 2, 0);
    const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: .9 });
    windPatch(mat, b, h, wind ?? [0.12, 1, 0.55][b.layers.length] ?? 0.5);
    const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true; mesh.receiveShadow = true;
    const hinge = new THREE.Group(); hinge.position.set(PLATE_X, PT + 0.003, b.pivotZ + dz); hinge.add(mesh);
    hinge.rotation.x = -Math.PI / 2; hinge.visible = false;
    b.vol.group.add(hinge); b.layers.push({ hinge, delay });
  }
}

// 头部跟随：镜头在兽本地坐标中的方位 → 头的偏转
const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _hc = new THREE.Vector3();
const pointer = new THREE.Vector2();
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
function updateHead(b, dt) {
  let tx = 0, ty = 0;
  if ((b.isDesk || b.isGuest || state === 'out') && b.pivot.visible) {
    _m.copy(b.fit.matrixWorld).invert();
    _v.copy(b.lookAt ? b.lookAt() : camera.position).applyMatrix4(_m).sub(_hc.set(...b.headC));
    const az = Math.atan2(_v.x, _v.z), el = Math.atan2(_v.y, Math.hypot(_v.x, _v.z));
    tx = THREE.MathUtils.clamp(wrapPi(az - b.restAz) * (b.lookAt ? 1 : 0.75) + (b.lookAt ? 0 : pointer.x * 0.25), b.yaw[0], b.yaw[1]);
    ty = THREE.MathUtils.clamp((el - 0.25) * 0.5 + pointer.y * 0.12, b.pitch[0], b.pitch[1]);
  }
  const k = 1 - Math.exp(-dt * 2.6);
  b.headNow.x += (tx - b.headNow.x) * k; b.headNow.y += (ty - b.headNow.y) * k;
  b.u.uHead.value.copy(b.headNow);
}
let nextEar = 3;
function updateEar(b, t) {
  if (!b.ears) return;
  if (b.nextEar === undefined) b.nextEar = nextEar, b.earT0 = -9;
  if (t > Math.max(b.nextEar, nextEar)) { b.nextEar = t + 2.5 + Math.random() * 4; b.earT0 = t; }
  const e = t - b.earT0;
  b.u.uEar.value = e < 0.35 ? Math.sin(e / 0.35 * Math.PI * 2) * (1 - e / 0.35) : 0;
}
function voice(b, level) {
  if (b.voice === 'stone') SFX.stone(level ? level * 1.6 : undefined);
  else if (b.voice === 'thunder') SFX.thunder(level ? level * 1.5 : undefined);
  else if (b.voice === 'clock') SFX.clock(level ? level * 1.5 : undefined);
  else if (b.voice === 'bells') SFX.bells(level ? level * 1.5 : undefined);
  else if (b.voice === 'yip') SFX.yip(level ? level * 1.4 : undefined);
  else SFX.cry(level);
}

/* ------------------------------------------------------------------ 出册特效：墨晕 */
const inkMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
  uniforms: { uR: { value: 0 }, uA: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `varying vec2 vUv; uniform float uR, uA;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
    float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
    void main(){
      vec2 p = (vUv - .5) * 2.0; float d = length(p * vec2(1.0, 1.35));
      float wob = (n(p * 6.0) - .5) * .12 + (n(p * 17.0) - .5) * .05;
      float ring = smoothstep(uR - .22, uR, d + wob) * (1.0 - smoothstep(uR, uR + .05, d + wob));
      float fill = (1.0 - smoothstep(0.0, uR, d + wob)) * .35;
      gl_FragColor = vec4(vec3(.16,.13,.11), (ring * .9 + fill) * uA * .55);
    }`,
});
const ink = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), inkMat);
ink.rotation.x = -Math.PI / 2; ink.visible = false; ink.renderOrder = 2;
function inkBloom(z, size = 1.6, dur = 1.6) {
  ink.position.set(PLATE_X, PT + 0.004, z);
  ink.scale.set(size, size, 1); ink.visible = true;
  return tween(dur, (k) => { inkMat.uniforms.uR.value = 0.15 + 0.85 * k; inkMat.uniforms.uA.value = Math.sin(Math.min(1, k * 1.6) * Math.PI * 0.5) * (1 - k); }, { e: ease.out })
    .then(() => { ink.visible = false; });
}

/* ------------------------------------------------------------------ 补间 */
const tweens = [];
let SLOW = 1, VT = null; // VT：测试用的虚拟时钟
const nowMs = () => (VT ?? performance.now());
const ease = {
  io: (t) => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  out: (t) => 1 - Math.pow(1 - t, 3),
  back: (t) => { const c1 = 0.7, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
};
function tween(dur, fn, { delay = 0, e = ease.io } = {}) {
  return new Promise((res) => tweens.push({ t0: nowMs() + delay * 1000 * SLOW, dur: dur * 1000 * SLOW, fn, e, res }));
}
const after = (sec, fn) => tween(0.001, () => {}, { delay: sec }).then(fn);

/* ================================================================== 招牌互动：每一页一个“见之则……” */
// 光点 / 火星：一个通用的粒子池
const MOTES = 600;
const moteGeo = new THREE.BufferGeometry();
moteGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MOTES * 3), 3));
moteGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MOTES * 3), 3));
const moteTex = (() => { const [c, g] = mk(64, 64); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.35, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c); })();
const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({ size: 0.07, map: moteTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
motes.frustumCulled = false; scene.add(motes);
const moteList = [];
function spawnMotes(n, at, { spread = 0.4, vel = [0, 0.6, 0], jitter = 0.4, color = '#ffd27a', life = 2.2, grav = 0, drag = 0.6 } = {}) {
  const c = new THREE.Color(color);
  for (let i = 0; i < n; i++) {
    if (moteList.length >= MOTES) moteList.shift();
    moteList.push({
      p: new THREE.Vector3(at.x + (Math.random() - .5) * spread, at.y + (Math.random() - .5) * spread * .6, at.z + (Math.random() - .5) * spread),
      v: new THREE.Vector3(vel[0] + (Math.random() - .5) * jitter, vel[1] + (Math.random() - .5) * jitter, vel[2] + (Math.random() - .5) * jitter),
      c, age: 0, life: life * (0.6 + Math.random() * 0.6), grav, drag,
    });
  }
}
function updateMotes(dt) {
  const P = moteGeo.attributes.position.array, C = moteGeo.attributes.color.array;
  let n = 0;
  for (let i = moteList.length - 1; i >= 0; i--) {
    const m = moteList[i]; m.age += dt;
    if (m.age > m.life) { moteList.splice(i, 1); continue; }
    m.v.y -= m.grav * dt; m.v.multiplyScalar(1 - m.drag * dt); m.p.addScaledVector(m.v, dt);
    const a = Math.sin(Math.min(1, m.age / m.life) * Math.PI);
    P[n * 3] = m.p.x; P[n * 3 + 1] = m.p.y; P[n * 3 + 2] = m.p.z;
    C[n * 3] = m.c.r * a; C[n * 3 + 1] = m.c.g * a; C[n * 3 + 2] = m.c.b * a; n++;
  }
  moteGeo.setDrawRange(0, n);
  moteGeo.attributes.position.needsUpdate = true; moteGeo.attributes.color.needsUpdate = true;
}

// 雨：落在书案上的雨丝（细长面片，始终转向镜头）
const RAIN = 650;
const rainTex = (() => { const [c, g] = mk(8, 64); const gr = g.createLinearGradient(0, 0, 0, 64);
  gr.addColorStop(0, 'rgba(220,232,255,0)'); gr.addColorStop(1, 'rgba(220,232,255,1)'); g.fillStyle = gr; g.fillRect(0, 0, 8, 64); return new THREE.CanvasTexture(c); })();
const rainMat = new THREE.MeshBasicMaterial({ map: rainTex, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
const rain = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.009, 0.3), rainMat, RAIN); rain.frustumCulled = false; rain.visible = false; scene.add(rain);
const rainDrops = Array.from({ length: RAIN }, () => ({ x: 0, y: 0, z: 0, v: 0 }));
function resetDrop(d, anyY) { d.x = (Math.random() - .5) * 8; d.z = (Math.random() - .5) * 5.5; d.y = anyY ? Math.random() * 5 : 4.5 + Math.random(); d.v = 5.5 + Math.random() * 2.5; }
rainDrops.forEach((d) => resetDrop(d, true));
let rainK = 0;
const _ro = new THREE.Object3D();
function updateRain(dt) {
  if (rainK <= 0.001) { rain.visible = false; return; }
  rain.visible = true; rainMat.opacity = 0.62 * rainK;
  const yaw = Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z);
  rainDrops.forEach((d, i) => {
    d.y -= d.v * dt; d.x -= 0.4 * dt;
    if (d.y < PT) { if (Math.random() < 0.3) spawnMotes(2, { x: d.x, y: PT + 0.02, z: d.z }, { spread: 0.02, vel: [0, 0.6, 0], jitter: 0.6, color: '#cfe0ff', life: 0.35, grav: 5, drag: 0 }); resetDrop(d); }
    _ro.position.set(d.x, d.y, d.z); _ro.rotation.set(0, yaw, 0.08); _ro.updateMatrix(); rain.setMatrixAt(i, _ro.matrix);
  });
  rain.instanceMatrix.needsUpdate = true;
}

// 暖光：九尾狐的瑞光、麦田的金光
const glowLight = new THREE.PointLight(0xffc870, 0, 6, 1.6); scene.add(glowLight);
const lampBase = { c: lamp.color.clone(), i: lamp.intensity }, hemiBaseI = scene.children.find((o) => o.isHemisphereLight).intensity;
function dimLights(k, tint = 0x8fa3c8) { // k: 0 正常 → 1 暗
  const h = scene.children.find((o) => o.isHemisphereLight);
  lamp.intensity = lampBase.i * (1 - 0.62 * k); lamp.color.copy(lampBase.c).lerp(new THREE.Color(tint), k * 0.7);
  h.intensity = hemiBaseI * (1 - 0.55 * k);
  renderer.toneMappingExposure = 1.05 * (1 - 0.2 * k);
}
function worldOf(f, mx, my, mz) { return f.fit.localToWorld(new THREE.Vector3(mx, my, mz)); }

// 爱丽丝的两件道具：DRINK ME 小瓶、EAT ME 小蛋糕
function labelTex(text, w = 256, h = 96, bg = '#f3ead6', fg = '#3a2a20', font = `italic 44px ${WSERIF}`) {
  const [c, g] = mk(w, h); g.fillStyle = bg; g.fillRect(0, 0, w, h); g.strokeStyle = fg; g.lineWidth = 3; g.strokeRect(6, 6, w - 12, h - 12);
  g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 + 2); return canvasTex(c);
}
function makeProps() {
  const bottle = new THREE.Group();
  const prof = [[0, 0], [0.09, 0], [0.1, 0.02], [0.1, 0.16], [0.07, 0.2], [0.035, 0.24], [0.035, 0.3], [0.045, 0.31], [0.045, 0.33], [0, 0.33]].map(([x, y]) => new THREE.Vector2(x, y));
  const glass = new THREE.Mesh(new THREE.LatheGeometry(prof, 28), new THREE.MeshStandardMaterial({ color: 0x8fc3e8, transparent: true, opacity: 0.6, roughness: 0.1, metalness: 0.1 }));
  const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.05, 16), new THREE.MeshStandardMaterial({ color: 0x9a6b42, roughness: .8 })); cork.position.y = 0.35;
  const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.065), new THREE.MeshStandardMaterial({ map: labelTex('DRINK ME'), side: THREE.DoubleSide, roughness: .9 }));
  tag.position.set(0, 0.1, 0.105); tag.rotation.x = -0.05;
  bottle.add(glass, cork, tag); bottle.userData.act = 'drink';
  const cake = new THREE.Group();
  const [tc, tg] = mk(256, 256); tg.fillStyle = '#f6ecd8'; tg.fillRect(0, 0, 256, 256); tg.fillStyle = '#5a2a22'; tg.font = `bold 58px ${WSERIF}`; tg.textAlign = 'center'; tg.textBaseline = 'middle';
  tg.fillText('EAT', 128, 98); tg.fillText('ME', 128, 160);
  const top = new THREE.MeshStandardMaterial({ map: canvasTex(tc), roughness: .9 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.14, 0.11, 32), [new THREE.MeshStandardMaterial({ color: 0xc89b62, roughness: .9 }), top, new THREE.MeshStandardMaterial({ color: 0xa9784a })]);
  cake.add(body); cake.userData.act = 'eat';
  [bottle, cake].forEach((o) => { o.visible = false; o.traverse((m) => { if (m.isMesh) m.castShadow = true; }); scene.add(o); });
  return { bottle, cake };
}
let props = null;
function placeProps(b, k) {
  if (!props) props = makeProps();
  const base = worldOf(b, 0, 0.02, 0);
  const s = Math.max(0.6, b.H / 1.4) * 1.1;
  props.bottle.scale.setScalar(s * k); props.cake.scale.setScalar(s * k);
  props.bottle.visible = props.cake.visible = k > 0.01;
  const t = clock.elapsedTime;
  props.bottle.position.set(base.x - 0.95, base.y + 0.25 + Math.sin(t * 1.1) * 0.06, base.z + 0.25);
  props.cake.position.set(base.x + 0.95, base.y - 0.1 + Math.sin(t * 1.3 + 1) * 0.06, base.z + 0.3);
  props.bottle.rotation.set(0.25, t * 0.5, Math.sin(t * 0.7) * 0.2);
  props.cake.rotation.set(0.5 + Math.sin(t * 0.6) * 0.1, -t * 0.4, 0.15);
}

// 金句：浮在画面上方
const quoteEl = $('quote');
function showQuote(a, b, sec = 6) { quoteEl.innerHTML = `<em>${a}</em><span>${b}</span>`; quoteEl.classList.add('on'); clearTimeout(showQuote.t); showQuote.t = setTimeout(() => quoteEl.classList.remove('on'), sec * 1000); }

const ACTS = {
  // 九尾狐：九尾齐展，周身起瑞光
  async glory(b) {
    SFX.bells(0.22); SFX.rise();
    const at = worldOf(b, 0, 0.3, 0.2);
    glowLight.position.copy(at).add(new THREE.Vector3(0, 0.6, 0.8));
    const iv = setInterval(() => spawnMotes(10, worldOf(b, (Math.random() - .5) * 3, Math.random() * 3 - 0.8, -0.3), { spread: 0.3, vel: [0, 0.5, 0], jitter: 0.3, color: '#ffcf6e', life: 2.4 }), 80);
    await tween(2.8, (k) => { const e = Math.sin(k * Math.PI); b.u.uSway.value = 1 + e * 3.2; glowLight.intensity = e * 5; }, { e: (t) => t });
    clearInterval(iv);
    showQuote('其状如狐而九尾', '世传九尾狐见，则天下太平', 4);
  },
  // 狰：扬起前身，重击于石，迸出火星
  async strike(b) {
    await tween(0.5, (k) => { b.squash.rotation.z = -0.26 * k; }, { e: ease.out });
    await tween(0.12, (k) => { b.squash.rotation.z = -0.26 + 0.31 * k; }, { e: (t) => t * t });
    SFX.stone(0.5); SFX.thump(0.45);
    const foot = worldOf(b, -0.78, -1.0, 0.1);
    spawnMotes(70, foot, { spread: 0.15, vel: [0, 1.6, 0], jitter: 2.4, color: '#ffae4a', life: 0.9, grav: 5, drag: 0.4 });
    spawnMotes(25, foot, { spread: 0.1, vel: [0, 0.9, 0], jitter: 1.2, color: '#fff1c2', life: 0.5, grav: 3 });
    inkBloom(b.pivotZ - 0.1, 1.4, 1.2);
    const c0 = controls.target.clone();
    await tween(0.35, (k) => { b.squash.rotation.z = 0.05 * (1 - k); camera.position.y += Math.sin(k * 40) * 0.01 * (1 - k); });
    controls.target.copy(c0);
  },
  // 应龙：旱而为应龙之状，乃得大雨
  async rain(b) {
    SFX.thunder(0.6); SFX.rain(7);
    b.u.uSway.value = 1.8;
    await tween(1.2, (k) => { rainK = k; dimLights(k); });
    await sleep(4.6);
    await tween(1.6, (k) => { rainK = 1 - k; dimLights(1 - k); });
    b.u.uSway.value = 1;
    showQuote('旱而为应龙之状，乃得大雨', '《大荒东经》', 4);
  },
  // 爱丽丝：喝我 → 变小；吃我 → 变大
  async drink(b) { await resizeBeast(b, (b.size || 1) < 1 ? 1 : 0.45, '#9fd0ff'); },
  async eat(b) { await resizeBeast(b, (b.size || 1) > 1 ? 1 : 1.7, '#ffb3c8'); },
  // 小王子：风吹麦浪。“麦子是金色的，它会让我想起你。”
  async wind(b) {
    const fox = b.companions[0], W = b.wind;
    SFX.wind(7.5); setTimeout(() => SFX.rustle(2.4, 0.3, 4200), 600);
    fox.lookAt = () => worldOf(b, 0, 0.09, 0);       // 狐狸转头看小王子
    fox.earT0 = clock.elapsedTime; setTimeout(() => (fox.earT0 = clock.elapsedTime), 1300);
    const iv = setInterval(() => spawnMotes(5, new THREE.Vector3(PLATE_X - 1.3, PT + 0.3 + Math.random() * 0.8, b.pivotZ - 0.6 + (Math.random() - .5) * 1.2),
      { spread: 0.3, vel: [1.4, 0.15, 0], jitter: 0.25, color: '#ffd77a', life: 2.2, drag: 0.2 }), 90);
    setTimeout(() => showQuote('Le blé, qui est doré, me fera souvenir de toi.', '麦子是金色的，它会让我想起你', 3.6), 900);
    await tween(7.2, (k) => {
      const env = Math.min(1, k / 0.12) * (1 - Math.max(0, (k - 0.7) / 0.3)); // 起风 → 吹 → 渐息
      W.uWind.value = env; W.uFront.value = -0.3 + k * 2.2; W.uGlow.value = Math.max(W.uGlow.value, Math.min(1, k * 1.6) * 0.75);
      b.u.uSway.value = 1 + env * 3.0; fox.u.uSway.value = 1 + env * 1.5;
    }, { e: (t) => t });
    clearInterval(iv);
    SFX.bells(0.22);
    showQuote("On ne voit bien qu'avec le cœur.", '真正重要的东西，用眼睛是看不见的', 6);
  },
};
function wheatGlow(b, k) {
  const l = b.layers[1]; if (!l) return;
  const m = l.hinge.children[0].material; m.emissive.set(0xffb640); m.emissiveIntensity = k * 0.55;
}
async function resizeBeast(b, to, color) {
  const from = b.size || 1;
  (to < from ? SFX.shrink : SFX.grow)();
  const iv = setInterval(() => spawnMotes(6, worldOf(b, (Math.random() - .5) * 0.15, Math.random() * 0.25 - 0.1, 0), { spread: 0.3, vel: [0, 0.3, 0], jitter: 0.6, color, life: 1.4 }), 60);
  await tween(1.4, (k) => { b.size = from + (to - from) * k; }, { e: ease.back });
  clearInterval(iv);
}
const ACT_LABELS = { glory: '展九尾', strike: '击石', rain: '祈雨', drink: '喝我', eat: '吃我', wind: '风吹麦浪', join: '我也入书 ▾', photo: '合影', nuzzle: '贴贴', hifive: '击掌', cage: '画地为牢', seal: '收服', snap: '留影', leave: '请回' };
const actsEl = $('acts');
let acting = false;
function showActs(b) {
  actsEl.innerHTML = '';
  const list = guests.length ? (pairCP && guests.length === 2 ? ['nuzzle', 'cage', 'snap', 'leave'] : ['nuzzle', 'snap', 'leave']) : [...(b.acts || []), 'join', 'photo'];
  list.forEach((a) => {
    const btn = document.createElement('button'); btn.className = 'act' + (a === 'join' ? ' join' : ''); btn.dataset.act = a;
    btn.textContent = ACT_LABELS[a];
    btn.onclick = () => (a === 'join' ? (pickerEl.classList.contains('on') ? closePicker() : openPicker()) : a === 'photo' ? $('photo').click() : runAct(b, a));
    actsEl.appendChild(btn);
  });
  actsEl.classList.add('on');
}
function hideActs() { actsEl.classList.remove('on'); closePicker(); }
async function runAct(b, a) {
  if (acting || state !== 'out' || cur !== b) return;
  touched = true;
  acting = true; actsEl.querySelectorAll('button').forEach((x) => (x.disabled = true));
  try { await ACTS[a](b); } finally {
    acting = false; actsEl.querySelectorAll('button').forEach((x) => { x.disabled = false; });
  }
}
// 归册前把互动留下的状态都收回
async function resetActs(b) {
  await removeGuests();
  hideActs(); quoteEl.classList.remove('on');
  const F = figs(b), fox = b.companions && b.companions[0];
  rainK = 0; dimLights(0); glowLight.intensity = 0;
  await tween(0.6, (k) => {
    F.forEach((f) => { if (f.size && f.size !== 1) f.size = f.size + (1 - f.size) * k; });
    if (b.wind) { b.wind.uGlow.value *= (1 - k); b.wind.uWind.value *= (1 - k); }
    if (props) placeProps(b, 1 - k);
  });
  F.forEach((f) => { f.size = 1; f.lookAt = null; });
  if (b.wind) { b.wind.uGlow.value = 0; b.wind.uWind.value = 0; b.wind.uFront.value = -0.3; }
}
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

/* ------------------------------------------------------------------ 摄像机机位 */
// 取景：把一个包围盒完整放进“可用画面”（扣掉题记卡、按钮、标题后的区域），并用 viewOffset 让主体落在可用区域的中心
const DEG = Math.PI / 180;
const view = { offX: 0, offY: 0 };
function freeArea(withNote) {
  const W = window.innerWidth, H = window.innerHeight, wide = camera.aspect > 1.1;
  let L = 16, R = W - 16, T = 74, B = H - 108;
  if (withNote) {
    if (wide) R = W - (note.offsetWidth + 52);
    else B = H - (note.offsetHeight + 156);
  }
  return { W, H, L, R, T, B };
}
const _corner = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3();
function frameBox(box, dir, { withNote = false, margin = 1.12 } = {}) {
  const A = freeArea(withNote);
  const tgt = box.getCenter(new THREE.Vector3());
  dir = dir.clone().normalize();
  _right.crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize(); _up.crossVectors(dir, _right).normalize();
  // 包围盒八个角在视线坐标中的范围
  let maxR = 0, maxU = 0, maxD = 0;
  for (let i = 0; i < 8; i++) {
    _corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(tgt);
    maxR = Math.max(maxR, Math.abs(_corner.dot(_right))); maxU = Math.max(maxU, Math.abs(_corner.dot(_up))); maxD = Math.max(maxD, _corner.dot(dir));
  }
  const tv = Math.tan(camera.fov * DEG / 2);
  const th = tv * (A.W / A.H);
  const fu = (A.B - A.T) / A.H, fr = (A.R - A.L) / A.W;   // 可用区域占全画面的比例
  const dist = Math.max(maxU / (tv * fu), maxR / (th * fr)) * margin + maxD;
  return {
    pos: tgt.clone().addScaledVector(dir, dist), tgt,
    offX: A.W / 2 - (A.L + A.R) / 2, offY: A.H / 2 - (A.T + A.B) / 2,
  };
}
// 兽立起后（含腾空）的世界包围盒
function standingBox(b) {
  const box = new THREE.Box3();
  for (const f of figs(b)) {
    const keep = [f.pivot.rotation.x, f.squash.scale.z, f.pivot.position.y, f.pivot.visible];
    f.pivot.rotation.x = 0; f.squash.scale.z = 1; f.pivot.position.y = PT + 0.004 + (f.hover || 0); f.pivot.visible = true;
    f.pivot.updateMatrixWorld(true);
    box.union(new THREE.Box3().setFromObject(f.fit));
    [f.pivot.rotation.x, f.squash.scale.z, f.pivot.position.y, f.pivot.visible] = keep;
    f.pivot.updateMatrixWorld(true);
  }
  return box;
}
const BOOK_BOX = new THREE.Box3(new THREE.Vector3(-PAGE_W - 0.08, 0, -PAGE_D / 2 - 0.08), new THREE.Vector3(PAGE_W + 0.08, PT + 0.05, PAGE_D / 2 + 0.08));
const SHOTS = {
  closed: () => {
    const tall = camera.aspect < 0.8, box = deskLayoutBox(false);
    deskFigs.forEach((c) => { if (c.pivot.parent) box.union(new THREE.Box3().setFromObject(c.pivot)); });
    // 与书房桌面的透视接近：低一些的斜俯视
    const f = frameBox(box, new THREE.Vector3(0, 1, 1.7), { margin: tall ? 1.05 : 1.75 });
    f.offY -= innerHeight * (tall ? 0.1 : 0.15); // 书落在桌垫中间，而不是桌垫后沿
    return f;
  },
  // 展卷：斜看整本书；竖屏时以左页图版为主
  open: () => camera.aspect < 0.8
    ? frameBox(new THREE.Box3(new THREE.Vector3(-PAGE_W - 0.05, 0, -PAGE_D / 2), new THREE.Vector3(0.6, PT, PAGE_D / 2)), new THREE.Vector3(0.05, 1, 0.68), { margin: 1.1 })
    : frameBox(BOOK_BOX, new THREE.Vector3(0, 1, 0.8), { margin: 1.08 }),
  // 正视（书）：几乎垂直俯看，像把书平摊在面前读
  top: () => camera.aspect < 0.8
    ? frameBox(new THREE.Box3(new THREE.Vector3(-PAGE_W - 0.05, 0, -PAGE_D / 2), new THREE.Vector3(0.3, PT, PAGE_D / 2)), new THREE.Vector3(0, 1, 0.12), { margin: 1.02 })
    : frameBox(BOOK_BOX, new THREE.Vector3(0, 1, 0.12), { margin: 1.03 }),
  // 封印狰：俯看整张书页，便于画圈
  arena: () => frameBox(new THREE.Box3(new THREE.Vector3(-PAGE_W - 0.1, 0, -PAGE_D / 2 - 0.1), new THREE.Vector3(PAGE_W + 0.1, 1.2, PAGE_D / 2 + 0.1)), new THREE.Vector3(0, 1, 0.78), { margin: 1.0 }),
  // 出册后的默认机位：右前上方 3/4
  beast: () => frameBox(sceneBox(), new THREE.Vector3(0.42, 0.42, 1), { withNote: true, margin: 1.1 }),
  // 正视（兽）：与画同向，平视——立起来的它与图版上的它正好同一个角度
  front: () => frameBox(sceneBox(), new THREE.Vector3(0, Math.tan(7 * DEG), 1), { withNote: true, margin: 1.14 }),
  snap: () => frameBox(sceneBox(), new THREE.Vector3(0, Math.tan(9 * DEG), 1), { margin: 1.08 }),
};
function applyOffset() {
  const W = window.innerWidth, H = window.innerHeight;
  if (Math.abs(view.offX) < 0.5 && Math.abs(view.offY) < 0.5) camera.clearViewOffset();
  else camera.setViewOffset(W, H, view.offX, view.offY, W, H);
}
// 沿弧线飞：目标点直线移动，视线方向球面插值，距离按对数插值
let lastShot = 'closed';
function flyTo(shot, dur = 1.6) {
  lastShot = shot;
  const to = SHOTS[shot]();
  const t0 = controls.target.clone(), v0 = camera.position.clone().sub(t0), v1 = to.pos.clone().sub(to.tgt);
  const d0 = v0.length(), d1 = v1.length(), n0 = v0.clone().normalize(), n1 = v1.clone().normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(n0, n1), qk = new THREE.Quaternion();
  const o0 = { x: view.offX, y: view.offY };
  return tween(dur, (k) => {
    controls.target.lerpVectors(t0, to.tgt, k);
    qk.identity().slerp(q, k);
    camera.position.copy(n0).applyQuaternion(qk).multiplyScalar(d0 * Math.pow(d1 / d0, k)).add(controls.target);
    view.offX = o0.x + (to.offX - o0.x) * k; view.offY = o0.y + (to.offY - o0.y) * k; applyOffset();
  });
}

/* ------------------------------------------------------------------ 翻页用的纸 */
const sheetU = { uBend: { value: 0 } };
function sheetMat(side) {
  const m = new THREE.MeshStandardMaterial({ roughness: .93, side, color: 0xe9e0cf });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, sheetU);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uBend;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float d = clamp((position.x - ${(GAP / 2).toFixed(3)}) / ${PAGE_W.toFixed(3)}, 0.0, 1.0);
        transformed.y += -uBend * 0.55 * d * d;               // 纸尖落后于翻动方向
        transformed.x -= abs(uBend) * 0.10 * d * d;`);
  };
  m.customProgramCacheKey = () => 'sheet' + side;
  return m;
}
const sheet = new THREE.Group();
{
  const geo = new THREE.PlaneGeometry(PAGE_W, PAGE_D, 48, 1); geo.rotateX(-Math.PI / 2); geo.translate(GAP / 2 + PAGE_W / 2, 0, 0);
  sheet.front = new THREE.Mesh(geo, sheetMat(THREE.FrontSide));
  sheet.back = new THREE.Mesh(geo, sheetMat(THREE.BackSide));
  sheet.front.castShadow = sheet.back.castShadow = true;
  sheet.add(sheet.front, sheet.back); sheet.position.set(0, PT + 0.006, 0); sheet.visible = false;
}

/* ------------------------------------------------------------------ 装配：书案上的几本书 */
const VOLUMES = [
  { id: 'shanhai', title: '山海图录', sub: '线装 · 三图', hook: '山海志怪', binding: 'right', gilt: false, beasts: BEASTS, nums: ['壹', '贰', '叁', '肆', '伍'] },
  { id: 'alice', title: '爱丽丝漫游奇境', sub: '布面精装 · 第一章', hook: '坠入洞中', binding: 'left', gilt: true, beasts: ALICE, nums: ['1', '2', '3'] },
  { id: 'prince', title: '小王子', sub: '布面精装 · 第二十一章', hook: '驯养一只狐狸', binding: 'left', gilt: false, beasts: PRINCE, nums: ['1', '2', '3'] },
];
// 书案布局：横屏并排，竖屏上下排（书的数量可变：导入的新书也会排上来）
const RY = [0.06, -0.04, -0.07, 0.05, -0.03, 0.04];
function deskSlot(i, n, tall) {
  return tall ? { x: (i % 2 ? 0.12 : -0.1), z: (i - (n - 1) / 2) * 3.9, ry: RY[i % RY.length] }
              : { x: (i - (n - 1) / 2) * 3.05, z: (i % 2 ? -0.1 : 0.1), ry: RY[i % RY.length] };
}
function deskLayoutBox(tall) {
  const n = VOLUMES.length;
  return tall ? new THREE.Box3(new THREE.Vector3(-1.5, 0, -(n - 1) / 2 * 3.9 - 1.9), new THREE.Vector3(1.5, 2 * PT, (n - 1) / 2 * 3.9 + 1.9))
              : new THREE.Box3(new THREE.Vector3(-(n - 1) / 2 * 3.05 - 1.45, 0, -2.0), new THREE.Vector3((n - 1) / 2 * 3.05 + 1.5, 2 * PT, 2.0));
}
function defineDesk(v) { Object.defineProperty(v, 'desk', { configurable: true, get: () => deskSlot(VOLUMES.indexOf(v), VOLUMES.length, false) }); }
VOLUMES.forEach(defineDesk);
const figs = (b) => [b, ...(b.companions || [])];
let vol = null, selIdx = 0, cur = null, curIdx = 0, plate = null;
let state = 'loading'; // loading → closed（书案）→ opening → idle → out → busy / turning / closing
VOLUMES.forEach((v) => v.beasts.forEach((b) => figs(b).forEach((f) => (f.vol = v))));

function prepPages(b, i) {
  const left = leftPageCanvas(b, 21 + i * 7), right = rightPageCanvas(b, 33 + i * 7);
  b.leftTex = canvasTex(left); b.rightTex = canvasTex(right);
  b.backTex = canvasTex(leftCompositeCanvas(left, b.plateImg));
  b.backTex.repeat.set(-1, 1); b.backTex.offset.set(1, 0); // 纸背翻过来后左右颠倒
  b.plateTex = new THREE.Texture(b.plateImg); b.plateTex.colorSpace = THREE.SRGBColorSpace; b.plateTex.anisotropy = renderer.capabilities.getMaxAnisotropy(); b.plateTex.needsUpdate = true;
  const [, pg] = mk(8, 8); pg.drawImage(b.plateImg, 0, 0, 8, 8);
  const px = pg.getImageData(0, 0, 1, 1).data;
  b.bg = new THREE.Color().setRGB(px[0] / 255, px[1] / 255, px[2] / 255, THREE.SRGBColorSpace);
}
// 一本书：两片可绕书脊转动的半本 + 图版 + 接触阴影。合上时，装订在右（线装）翻右半，装订在左（西式）翻左半
function buildVolume(v, looks) {
  const g = v.group = new THREE.Group(); scene.add(g);
  const clothTex = imgTex(looks.cloth, { repeat: 1.4, mirror: true });
  const cloth = new THREE.MeshStandardMaterial({ map: clothTex, roughness: .9 });
  const cover = new THREE.MeshStandardMaterial({ map: imgTex(looks.cover, { rot: Math.PI }), roughness: v.gilt ? .7 : .88 });
  const b0 = v.beasts[0];
  v.leftHinge = new THREE.Group(); v.rightHinge = new THREE.Group();
  v.leftHinge.position.set(0, PT, 0); v.rightHinge.position.set(0, PT, 0); g.add(v.leftHinge, v.rightHinge);
  v.leftHalf = makeHalf(-1, b0.leftTex, { cloth, cover: v.binding === 'left' ? cover : null }, v.gilt); v.leftHalf.position.y = -PT; v.leftHinge.add(v.leftHalf);
  v.rightHalf = makeHalf(1, b0.rightTex, { cloth, cover: v.binding === 'right' ? cover : null }, v.gilt); v.rightHalf.position.y = -PT; v.rightHinge.add(v.rightHalf);
  const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, PAGE_D + 0.16, 16, 1, false, Math.PI, Math.PI), cloth);
  spine.rotation.x = Math.PI / 2; spine.position.set(0, 0.012, 0); g.add(spine);
  v.plate = makePlate(b0.plateTex); v.plate.position.y = 0.0015; v.leftHinge.add(v.plate);
  v.aoL = aoQuad(PAGE_W + 0.9, PAGE_D + 0.9); v.aoL.position.set(-(PAGE_W / 2 + 0.05), 0.002, 0.04);
  v.aoR = aoQuad(PAGE_W + 0.9, PAGE_D + 0.9); v.aoR.position.set(PAGE_W / 2 + 0.05, 0.002, 0.04);
  g.add(v.aoL, v.aoR);
  v.hinge = v.binding === 'right' ? v.rightHinge : v.leftHinge;
  v.closedAngle = v.binding === 'right' ? Math.PI : -Math.PI;
  v.hinge.rotation.z = v.closedAngle;
  placeOnDesk(v, 1);
}
// 书案上的摆放：合上的书叠在书脊一侧，所以按“书堆中心”摆
function deskPose(v) {
  const off = v.binding === 'right' ? PAGE_W / 2 + 0.06 : -(PAGE_W / 2 + 0.06);
  return { x: v.desk.x + off * Math.cos(v.desk.ry), z: v.desk.z - off * Math.sin(v.desk.ry), ry: v.desk.ry };
}
function placeOnDesk(v, k = 1) {
  const d = deskPose(v);
  v.group.position.set(d.x * k, 0, d.z * k); v.group.rotation.y = d.ry * k;
}
function setOpen(v, k) { v.hinge.rotation.z = v.closedAngle * (1 - k); }
function setLeft(b) { vol.leftHalf.userData.page.material.map = b.leftTex; vol.plate.material.map = b.plateTex; plateUniforms.uBg.value.copy(b.bg); }
function setRight(b) { vol.rightHalf.userData.page.material.map = b.rightTex; }

/* ------------------------------------------------------------------ 兔子洞（爱丽丝出册时，书案隐去） */
const holeEl = $('hole');
let holeK = 0;
const hemi = scene.children.find((o) => o.isHemisphereLight);
const hemiDay = hemi.color.clone(), hemiHole = new THREE.Color(0xd9c4ff);
function setHole(k) {
  holeK = k;
  VOLUMES.forEach((v) => { if (v !== vol) v.group.visible = k < 0.99; });
  applyBack();
  hemi.color.copy(hemiDay).lerp(hemiHole, k);
  holeEl.style.opacity = k;
  floatEl.style.opacity = floatOn ? k : 0;
}
// 兔子洞里漂浮的旧物：她在下坠，所以东西往上飘（手绘道具，分远近）
const floatEl = $('floaters');
let floatOn = false;
const FLOATERS = ['al_a0','al_a1','al_a2','al_a3','al_a4','al_a5','al_a6','al_a7','al_a8','al_a9','al_b0','al_b1','al_b2','al_b3','al_b4','al_b5','al_b6','al_b7','al_b8','al_b9','al_b10'];
function fillFloaters() {
  if (floatEl.childElementCount) return;
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  FLOATERS.forEach((n, i) => {
    const im = document.createElement('img'); im.src = `assets/${n}.webp`; im.alt = '';
    const z = rnd(), side = i % 2 ? 1 : 0; // z: 0 远 → 1 近
    const left = side ? 64 + rnd() * 30 : 2 + rnd() * 28;
    const d = 34 - z * 18, r0 = (rnd() - 0.5) * 120, spin = (rnd() < 0.5 ? -1 : 1) * (80 + rnd() * 260);
    Object.assign(im.style, { left: left + '%' });
    im.style.setProperty('--w', (3.6 + z * 6.5).toFixed(1) + 'vmax');
    im.style.setProperty('--bl', ((1 - z) * 1.6).toFixed(2) + 'px');
    im.style.setProperty('--o', (0.55 + z * 0.45).toFixed(2));
    im.style.setProperty('--d', d.toFixed(1) + 's');
    im.style.setProperty('--dl', (-rnd() * d).toFixed(1) + 's');
    im.style.setProperty('--r0', r0.toFixed(0) + 'deg'); im.style.setProperty('--r1', (r0 + spin).toFixed(0) + 'deg');
    floatEl.appendChild(im);
  });
}
const BG = scene.background, FOG = scene.fog;
deskMat.transparent = true; desk.renderOrder = -2;

/* ------------------------------------------------------------------ 界面 */
const goBtn = $('go'), viewBtn = $('view'), hint = $('hint'), note = $('note');
const prevBtn = $('prev'), nextBtn = $('next'), pagerTxt = $('pager'), shelfBtn = $('shelf');
function renderNote(b) {
  const n = b.note;
  note.innerHTML = `<h2>${n.h}</h2>` + n.rows.map(([k, v]) => `<p><i>${k}</i>　${v}</p>`).join('') +
    `<small>${n.src}</small><div class="stamp">${n.stamp}</div>`;
  $('brandTitle').textContent = vol.title;
  $('brandSub').textContent = b.brand;
  pagerTxt.textContent = vol.beasts.length > 1 ? `${vol.nums[curIdx]} / ${vol.nums[vol.beasts.length - 1]}` : '';
}
function deskUI() {
  $('brandTitle').textContent = '出册'; $('brandSub').textContent = '跃然纸上';
  pagerTxt.textContent = '';
  hint.textContent = '每一本书，都有人等待你翻开'; hint.style.opacity = 1;
}
function idleHint() { hint.textContent = `轻触${vol.binding === 'left' ? '插图' : '图版'}，请${cur.name}出册`; hint.style.opacity = state === 'idle' ? 1 : 0; }
function setBusy(b) {
  goBtn.disabled = b; controls.enabled = !b && state !== 'closed'; // 书案是一张画：镜头不可转
  const reading = state === 'idle' || state === 'out';
  viewBtn.disabled = b || !reading;
  shelfBtn.disabled = b || !reading; shelfBtn.style.opacity = reading && !b ? 1 : 0;
  const desk = state === 'closed';
  $('import').style.display = desk ? '' : 'none'; viewBtn.style.display = desk ? 'none' : '';
  $('import').disabled = b; $('photo').disabled = b; $('photo').style.display = 'none';
  prevBtn.style.display = nextBtn.style.display = desk ? 'none' : '';
  if (state === 'closed') { prevBtn.disabled = b || selIdx === 0; nextBtn.disabled = b || selIdx === VOLUMES.length - 1; return; }
  const nav = b || !vol;
  prevBtn.disabled = nav || curIdx === 0; nextBtn.disabled = nav || curIdx === vol.beasts.length - 1;
}

const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let downAt = null;
canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; if (typeof closePicker === 'function') closePicker(); });
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
  const hits = pick(e); if (!hits) return;
  if (state === 'closed') { if (hits.vol) { selIdx = VOLUMES.indexOf(hits.vol); openBook(); } else { const hot = hotAt(e.clientX, e.clientY); if (hot) hot.act(e.clientX, e.clientY); } return; }
  if (state === 'idle' && hits.plate) chuce();
  else if (state === 'out' && hits.act) runAct(cur, hits.act);
  else if (state === 'out' && hits.beast) tapFigure(hits.beast);
});
canvas.addEventListener('pointermove', (e) => {
  pointer.set(e.clientX / window.innerWidth * 2 - 1, -(e.clientY / window.innerHeight * 2 - 1));
  const h = pick(e);
  if (state === 'closed') {
    if (h && h.vol && VOLUMES.indexOf(h.vol) !== selIdx) { selIdx = VOLUMES.indexOf(h.vol); deskUI(); setBusy(false); }
    deskHover = !!(h && h.vol);
    if (deskHover && selIdx !== lastHoverIdx) { lastHoverIdx = selIdx; SFX.rustle(0.3, 0.1, 3800); SFX.pluck(659.25, 0.05); }
    if (!deskHover) lastHoverIdx = -1;
    par.tx = e.clientX / innerWidth - 0.5; par.ty = e.clientY / innerHeight - 0.5;
    const hot = deskHover ? null : hotAt(e.clientX, e.clientY);
    showHotTip(hot, e.clientX, e.clientY); dustAt(e.clientX, e.clientY);
    canvas.style.cursor = (h && h.vol) || hot ? 'pointer' : ''; return;
  }
  if (state !== 'idle' && state !== 'out') { canvas.style.cursor = ''; return; }
  canvas.style.cursor = h && ((state === 'idle' && h.plate) || (state === 'out' && (h.beast || h.act))) ? 'pointer' : '';
});
function pick(e) {
  if (!VOLUMES[0].group) return null;
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  if (state === 'closed') {
    // 只认可见物体（书里藏着没立起的纸景、兽，不可挡住别的书），取最近的一本
    const shown = (o) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
    let best = null;
    for (const v of VOLUMES) { const h = ray.intersectObject(v.group, true).find((x) => shown(x.object)); if (h && (!best || h.distance < best.d)) best = { v, d: h.distance }; }
    return best ? { vol: best.v } : {};
  }
  if (props && props.bottle.visible) { const ph = ray.intersectObjects([props.bottle, props.cake], true)[0]; if (ph) { let o = ph.object; while (o && !o.userData.act) o = o.parent; if (o) return { act: o.userData.act }; } }
  const hitFig = cur.pivot.visible ? figs(cur).find((f) => ray.intersectObjects(f.meshes).length > 0) : null;
  return { plate: ray.intersectObject(vol.plate).length > 0, beast: hitFig || null };
}
function navigate(dir) {
  if (state === 'closed') { const n = selIdx + dir; if (n >= 0 && n < VOLUMES.length) { selIdx = n; deskUI(); setBusy(false); SFX.rustle(0.3, 0.2); } return; }
  turn(dir);
}
goBtn.onclick = () => (state === 'closed' ? openBook() : state === 'idle' ? chuce() : state === 'out' ? guice() : null);
prevBtn.onclick = () => navigate(-1);
nextBtn.onclick = () => navigate(1);
shelfBtn.onclick = () => closeBook();
window.addEventListener('keydown', (e) => {
  if (state === 'boss') return;
  if (e.key === 'ArrowRight') navigate(1);
  else if (e.key === 'ArrowLeft') navigate(-1);
  else if (e.key === 'Escape') closeBook();
  else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); goBtn.click(); }
});
window.addEventListener('pointerdown', () => SFX.initAudio(), { capture: true });
const muteBtn = $('mute');
muteBtn.onclick = () => { SFX.initAudio(); SFX.setMuted(!SFX.isMuted()); muteBtn.classList.toggle('off', SFX.isMuted()); muteBtn.setAttribute('aria-pressed', SFX.isMuted()); };
let autoOpen = null;
let viewFront = false;
function setViewLabel(front) { viewFront = front; viewBtn.textContent = front ? '复位' : '正视'; }
viewBtn.onclick = () => {
  if (state !== 'idle' && state !== 'out') return;
  const shot = viewFront ? (state === 'out' ? 'beast' : 'open') : (state === 'out' ? 'front' : 'top');
  controls.enabled = false; viewBtn.disabled = true;
  flyTo(shot, 1.3).then(() => { controls.enabled = true; viewBtn.disabled = false; setViewLabel(!viewFront); });
};
controls.addEventListener('start', () => { if (viewFront) setViewLabel(false); }); // 手动转动后，按钮回到“正视”

/* ------------------------------------------------------------------ 动作 */

/* ------------------------------------------------------------------ 第一视角的手：捏书角翻开、按住书页、食指轻点 */
// 锚点（相对图片宽高）：捏合点、掌心、指尖
const HANDS = {
  pinch: { el: $('hPinch'), ax: 0.083, ay: 0.173 },
  flat: { el: $('hFlat'), ax: 0.516, ay: 0.525 },
  point: { el: $('hPoint'), ax: 0.069, ay: 0.141 },
};
const _hv = new THREE.Vector3(), _hv2 = new THREE.Vector3();
function scr(v) { v.project(camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; }
function pageWpx() {
  const a = scr(vol.group.localToWorld(_hv.set(0, PT, PAGE_D / 2))), b = scr(vol.group.localToWorld(_hv2.set(PAGE_W, PT, PAGE_D / 2)));
  return Math.max(150, Math.min(560, Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.9));
}
function placeHand(h, x, y, w, rot = 0) {
  const H = w * 933 / 700, el = h.el;
  el.style.width = w.toFixed(1) + 'px'; el.style.display = 'block';
  el.style.transformOrigin = `${(h.ax * w).toFixed(1)}px ${(h.ay * H).toFixed(1)}px`;
  el.style.transform = `translate(${(x - h.ax * w).toFixed(1)}px,${(y - h.ay * H).toFixed(1)}px) rotate(${rot.toFixed(1)}deg)`;
}
async function handRun(h, getT, getW, { delay = 0, inD = 0.4, hold = 1, outD = 0.45, from = 'right', rot0 = 0, rot1 = 0, press = 0 } = {}) {
  if (delay) await sleep(delay);
  const off = () => { const w = getW(); return from === 'right' ? [innerWidth + w * 0.3, innerHeight + w * 0.5] : [-w * 0.4, innerHeight + w * 0.6]; };
  let cur = [0, 0];
  await tween(inD, (k) => { const [tx, ty] = getT(), [ox, oy] = off(); cur = [ox + (tx - ox) * k, oy + (ty - oy) * k]; placeHand(h, cur[0], cur[1], getW(), rot0); }, { e: ease.out });
  await tween(hold, (k) => { const [tx, ty] = getT(); cur = [tx, ty + press * Math.sin(Math.min(1, k * 3) * Math.PI)]; placeHand(h, cur[0], cur[1], getW(), rot0 + (rot1 - rot0) * k); });
  const c0 = cur.slice();
  await tween(outD, (k) => { const [ox, oy] = off(); placeHand(h, c0[0] + (ox - c0[0]) * k, c0[1] + (oy - c0[1]) * k, getW(), rot1); }, { e: ease.io });
  h.el.style.display = 'none';
}
// 封面自由角（靠近读者的那个角）
function coverCorner(v) { const side = v.binding === 'right' ? 1 : -1; return scr(v.hinge.localToWorld(_hv.set(side * PAGE_W * 0.97, -PT + 0.01, PAGE_D / 2 - 0.12))); }
function sheetCorner() { return scr(sheet.localToWorld(_hv.set(GAP / 2 + PAGE_W * 0.94, 0.01, PAGE_D / 2 - 0.15))); }
function pressPoint(dir) { return scr(vol.group.localToWorld(_hv.set((dir > 0 ? -1 : 1) * PAGE_W * 0.5, PT, PAGE_D * 0.3))); }
function handPoke(x, y) { if (!vol) return; handRun(HANDS.point, () => [x, y], pageWpx, { inD: 0.22, hold: 0.22, outD: 0.32, press: 7 }); }

// 每帧跟随封面 / 书页的实际进度：掀到一半前手一直捏着，过半才松手（与帧率无关）
const handCtl = { open: null, turn: null };
const clamp01 = (x) => Math.max(0, Math.min(1, x));
function handOff(from, w) { return from === 'right' ? [innerWidth + w * 0.3, innerHeight + w * 0.5] : [-w * 0.4, innerHeight + w * 0.6]; }
function handAt(h, target, from, inK, outK, rot) {
  const w = pageWpx(), off = handOff(from, w), e1 = ease.out(clamp01(inK)), e2 = ease.io(clamp01(outK));
  const x = off[0] + (target[0] - off[0]) * e1, y = off[1] + (target[1] - off[1]) * e1;
  placeHand(h, x + (off[0] - x) * e2, y + (off[1] - y) * e2, w, rot);
}
function updateHands(dt) {
  const O = handCtl.open;
  if (O) {
    O.t += dt;
    const v = O.v, o = clamp01(1 - v.hinge.rotation.z / v.closedAngle);
    const outK = Math.max((o - 0.5) / 0.3, state === 'opening' ? 0 : 1);
    handAt(HANDS.pinch, coverCorner(v), 'right', O.t / 0.5, outK, (v.binding === 'right' ? 14 : -18) * o);
    if (outK >= 1) { HANDS.pinch.el.style.display = 'none'; handCtl.open = null; }
  }
  const T = handCtl.turn;
  if (T) {
    T.t += dt;
    const p = clamp01(T.dir > 0 ? sheet.rotation.z / Math.PI : 1 - sheet.rotation.z / Math.PI);
    const pin = Math.max((p - 0.55) / 0.3, T.done ? 1 : 0), flat = T.done ? (T.out = (T.out || 0) + dt / 0.4) : 0;
    handAt(HANDS.pinch, sheetCorner(), 'right', T.t / 0.3, pin, (T.dir > 0 ? -22 : 16) * p);
    handAt(HANDS.flat, pressPoint(T.dir), 'left', T.t / 0.3, flat, 0);
    if (pin >= 1) HANDS.pinch.el.style.display = 'none';
    if (flat >= 1) { HANDS.flat.el.style.display = 'none'; handCtl.turn = null; }
  }
}
async function openBook() {
  if (state !== 'closed' || making) return;
  if (lampOff) { lampOff = false; studyEl.classList.remove('lampoff'); dimLights(0); }
  clearTimeout(autoOpen);
  vol = VOLUMES[selIdx]; cur = vol.beasts[0]; curIdx = 0;
  state = 'opening'; setBusy(true); hint.style.opacity = 0;
  setLeft(cur); setRight(cur); renderNote(cur);
  vol.group.add(sheet, ink);
  SFX.initAudio();
  // 选中的书移到面前，其余的推到书案两边
  const moves = VOLUMES.map((v) => {
    const from = { x: v.group.position.x, z: v.group.position.z, r: v.group.rotation.y };
    const to = v === vol ? { x: 0, z: 0, r: 0 } : { x: (VOLUMES.indexOf(v) < VOLUMES.indexOf(vol) ? -1 : 1) * 10.5, z: deskPose(v).z * 0.3 - 1.0, r: v.desk.ry * 2 };
    return tween(1.1, (k) => { v.group.position.x = from.x + (to.x - from.x) * k; v.group.position.z = from.z + (to.z - from.z) * k; v.group.rotation.y = from.r + (to.r - from.r) * k; }, { e: ease.io });
  });
  const cam = flyTo('open', 2.6);
  handCtl.open = { t: 0, v: vol };
  after(0.7, () => SFX.pageTurn('open'));
  await Promise.all([...moves, cam, tween(2.0, (k) => setOpen(vol, k), { e: ease.io, delay: 0.7 })]);
  goBtn.textContent = '出册';
  state = 'idle'; setBusy(false); idleHint(); setViewLabel(false);
  after(0.15, () => chuce()); // 翻开即出册
}
async function closeBook() {
  if (state === 'out') await guice();
  if (state !== 'idle') return;
  state = 'closing'; setBusy(true); hint.style.opacity = 0; setViewLabel(false); note.classList.remove('on');
  SFX.pageTurn('close');
  await tween(1.6, (k) => setOpen(vol, 1 - k), { e: ease.io });
  // 先回到第一页，下次翻开从头看
  cur = vol.beasts[0]; curIdx = 0; setLeft(cur); setRight(cur);
  const moves = VOLUMES.map((v) => {
    const from = { x: v.group.position.x, z: v.group.position.z, r: v.group.rotation.y }, to = deskPose(v);
    return tween(1.2, (k) => { v.group.position.x = from.x + (to.x - from.x) * k; v.group.position.z = from.z + (to.z - from.z) * k; v.group.rotation.y = from.r + (to.ry - from.r) * k; }, { e: ease.io });
  });
  await Promise.all([...moves, flyTo('closed', 1.6)]);
  state = 'closed'; goBtn.textContent = '翻开'; deskUI(); setBusy(false); goBtn.disabled = false;
}

// 翻页：dir = 1 向后，-1 向前；若兽在书外，先归册
async function turn(dir) {
  const ni = curIdx + dir;
  if (!vol || ni < 0 || ni >= vol.beasts.length) return;
  if (state === 'out') { await guice(); }
  if (state !== 'idle') return;
  state = 'turning'; setBusy(true); hint.style.opacity = 0;
  const nb = vol.beasts[ni], ob = cur;
  if (lastShot !== 'open' || viewFront) { setViewLabel(false); await flyTo('open', 0.9); }
  { // 先把这一页的纸角放好，手才有东西可捏
    const pre = dir > 0 ? 0 : Math.PI; sheet.rotation.z = pre;
    handCtl.turn = { t: 0, dir, done: false };
    await sleep(0.3);
  }
  SFX.pageTurn('turn');
  if (dir > 0) {
    sheet.front.material.map = ob.rightTex; sheet.back.material.map = nb.backTex;
    sheet.front.material.needsUpdate = sheet.back.material.needsUpdate = true;
    sheet.rotation.z = 0; sheet.visible = true; setRight(nb);
    await tween(1.25, (k) => { sheet.rotation.z = Math.PI * k; sheetU.uBend.value = Math.sin(k * Math.PI) * 0.9; }, { e: ease.io });
    setLeft(nb);
  } else {
    sheet.front.material.map = nb.rightTex; sheet.back.material.map = ob.backTex;
    sheet.front.material.needsUpdate = sheet.back.material.needsUpdate = true;
    sheet.rotation.z = Math.PI; sheet.visible = true; setLeft(nb);
    await tween(1.25, (k) => { sheet.rotation.z = Math.PI * (1 - k); sheetU.uBend.value = -Math.sin(k * Math.PI) * 0.9; }, { e: ease.io });
    setRight(nb);
  }
  if (handCtl.turn) handCtl.turn.done = true;
  sheet.visible = false; sheetU.uBend.value = 0;
  cur = nb; curIdx = ni; renderNote(cur);
  state = 'idle'; setBusy(false); idleHint();
  after(0.1, () => chuce()); // 翻到哪页，哪页就出册
}

function layerPose(l, k) { // k: 0 平放（收起）→ 1 立起
  l.hinge.rotation.x = -Math.PI / 2 * (1 - k);
  l.hinge.scale.y = Math.min(1, 0.02 + Math.max(0, k) * 1.15);
}

async function chuce() {
  if (state !== 'idle') return;
  const b = cur, F = figs(b); setViewLabel(false); touched = false;
  state = 'busy'; setBusy(true); hint.style.opacity = 0;
  SFX.rise();
  // 1. 纸面微微鼓起
  await tween(0.4, (k) => { plateUniforms.uBulge.value = k * 0.35; }, { e: ease.out });
  // 2. 画中的它们变成一层浅浮雕，与原画重合
  F.forEach((f) => { f.pivot.visible = true; f.pivot.rotation.x = -Math.PI / 2; f.squash.scale.z = 0.03; f.pivot.position.y = PT + 0.004; });
  SFX.rustle(0.7, 0.2);
  await Promise.all([
    tween(0.35, (k) => { plateUniforms.uBulge.value = 0.35 * (1 - k); plateUniforms.uOut.value = k; }),
    tween(0.7, (k) => F.forEach((f) => { f.squash.scale.z = 0.03 + 0.27 * k; }), { e: ease.out }),
  ]);
  // 3. 以足为轴，从纸上立起；纸景随之展开（同页的几个角色前后错开一点）
  const cam = flyTo('beast', b.hole ? 3.2 : 2.3);
  b.layers.forEach((l) => { layerPose(l, 0); l.hinge.visible = true; });
  after(0.15, () => SFX.rustle(1.1, 0.45, 3200));
  if (!b.hole) after(0.75, () => { SFX.thump(0.35); inkBloom(b.pivotZ - 0.15, 1.9, 1.8); });
  after(1.0, () => SFX.rustle(0.6, 0.25, 1800));
  const jobs = [
    ...F.flatMap((f, i) => [
      tween(1.45, (k) => { f.pivot.rotation.x = -Math.PI / 2 * (1 - k); }, { e: ease.back, delay: i * 0.25 }),
      tween(1.1, (k) => { f.squash.scale.z = 0.3 + 0.7 * k; }, { e: ease.out, delay: 0.1 + i * 0.25 }),
      tween(1.6, (k) => { f.u.uSway.value = k; f.u.uLife.value = k; }, { delay: 1.1 + i * 0.25 }),
    ]),
    ...b.layers.map((l) => tween(1.3, (k) => layerPose(l, k), { e: ease.back, delay: 0.2 + l.delay })),
    cam,
  ];
  if (b.hover) jobs.push(tween(b.hole ? 2.4 : 1.6, (k) => { b.lift = k; }, { e: ease.io, delay: 0.9 })); // 腾空
  floatOn = !!b.hole; if (b.hole) fillFloaters();
  if (b.hole) { holeEl.style.backgroundImage = 'url(assets/rabbit.jpg)'; hemiHole.set(0xd9c4ff); jobs.push(tween(2.6, (k) => setHole(k), { e: ease.io, delay: 0.8 })); after(0.9, () => SFX.fall()); } // 掉进兔子洞
  else if (b.world) { holeEl.style.backgroundImage = `url(assets/${b.world})`; hemiHole.set(b.worldTint || 0xffffff); jobs.push(tween(2.4, (k) => setHole(k), { e: ease.io, delay: 0.5 })); after(0.6, () => SFX.bells(0.16)); } // 世界铺开
  await Promise.all(jobs);
  state = 'out';
  voice(b); if (F[1]) after(0.9, () => voice(F[1])); nextEar = clock.elapsedTime + 1.2;
  after(0.5, () => { if (state === 'out' && cur === b) { note.classList.add('on'); SFX.pluck(293.66); } });
  after(1.0, () => { if (state === 'out' && cur === b) { showActs(b); if (b.props) tween(0.8, (k) => placeProps(b, k), { e: ease.back }); } });
  goBtn.textContent = '归册'; setBusy(false);
  if (b.id === 'zheng' && !bossSeen) after(0.6, () => startBoss(b));
}

async function guice() {
  const b = cur, F = figs(b); setViewLabel(false);
  state = 'busy'; setBusy(true); note.classList.remove('on');
  await resetActs(b);
  const cam = flyTo('open', 2.0);
  SFX.ret(); SFX.rustle(1.0, 0.18, 2200);
  after(1.1, () => { SFX.thump(0.25); });
  const d0 = { y: b.squash.rotation.y, z: b.squash.rotation.z };
  const jobs = [
    ...F.flatMap((f) => [
      tween(0.6, (k) => { f.u.uSway.value = 1 - k; f.u.uLife.value = 1 - k; }),
      tween(1.1, (k) => { f.pivot.rotation.x = -Math.PI / 2 * k; }, { e: ease.io, delay: 0.2 }),
      tween(1.0, (k) => { f.squash.scale.z = 1 - 0.97 * k; }, { e: ease.io, delay: 0.35 }),
    ]),
    tween(0.8, (k) => { b.squash.rotation.y = d0.y * (1 - k); b.squash.rotation.z = d0.z * (1 - k); }),
    ...b.layers.map((l) => tween(1.0, (k) => layerPose(l, 1 - k), { e: ease.io, delay: 0.5 - l.delay })),
    cam,
  ];
  if (b.hover) jobs.push(tween(0.6, (k) => { b.lift = 1 - k; }, { e: ease.io }));
  if (b.hole || b.world) jobs.push(tween(1.6, (k) => setHole(1 - k), { e: ease.io }));
  await Promise.all(jobs);
  b.layers.forEach((l) => (l.hinge.visible = false));
  F.forEach((f) => (f.pivot.visible = false));
  await tween(0.7, (k) => { plateUniforms.uOut.value = 1 - k; plateUniforms.uBulge.value = Math.sin(k * Math.PI) * 0.3; });
  goBtn.textContent = '出册'; state = 'idle'; setBusy(false); idleHint();
}

let hopping = false;
async function hop(f = cur) {
  if (hopping) return; hopping = true;
  const show = !note.classList.contains('on');
  voice(f, 0.13);
  const amp = f.hover ? 0.3 : 0.18 * Math.min(1, f.H / 1.4);
  if (f.hover) f.u.uSway.value = 1.8; // 振翅 / 裙摆翻飞
  await tween(f.hover ? 0.9 : 0.5, (k) => { f.hop = Math.sin(k * Math.PI) * amp; f.fit.rotation.y = Math.sin(k * Math.PI) * 0.25; }, { e: (t) => t });
  f.u.uSway.value = 1;
  if (!f.hover) { SFX.thump(0.18); if (!f.isDesk) inkBloom(f.pivotZ - 0.15, 1.1, 1.1); }
  if (!f.isDesk) { note.classList.toggle('on', show); if (show) SFX.pluck(329.63, 0.16); }
  hopping = false;
}

/* ================================================================== 点它：角色本身就是按钮 */
let touched = false;
function tapFigure(f) {
  if (downAt) handPoke(downAt[0], downAt[1]);
  touched = true;
  const b = cur, a = (b.acts || [])[0];
  if (acting) return;
  if (b.id === 'yinglong') { hop(f); return; }           // 应龙：按住下雨，点一下只是腾跃
  if (!a || b.props) { hop(f); return; }                  // 爱丽丝：点小瓶 / 蛋糕
  runAct(b, a);
}
// 按住应龙：乌云聚拢、大雨落下；松手雨停
let rainSnd = null;
function holdRainStart() {
  touched = true; acting = true;
  cur.u.uSway.value = 1.8; SFX.thunder(0.45); rainSnd = SFX.rainStart();
  tween(0.9, (k) => { rainK = Math.max(rainK, k); dimLights(rainK); });
}
function holdRainStop() {
  if (rainSnd) { rainSnd.stop(); rainSnd = null; }
  const k0 = rainK;
  tween(1.4, (k) => { rainK = k0 * (1 - k); dimLights(rainK); }).then(() => { acting = false; if (cur.id === 'yinglong') { cur.u.uSway.value = 1; showQuote('旱而为应龙之状，乃得大雨', '《大荒东经》', 3.5); } });
}
// 光环提示：出册后在主角色身上一圈呼吸的光，写着“点它 / 按住它”
const tapHint = $('tapHint');
function hintText(b) { return b.id === 'yinglong' ? '长按 · 祈雨' : b.props ? '来一口 · deepdrink' : '轻触'; }
function updateTapHint() {
  const show = state === 'out' && !touched && !acting && cur && !drag && !guests.length;
  tapHint.classList.toggle('on', show);
  if (!show) return;
  const target = cur.props && props && props.bottle.visible ? props.bottle : cur.fit;
  const v = new THREE.Box3().setFromObject(target).getCenter(new THREE.Vector3()).project(camera);
  tapHint.style.transform = `translate(${(v.x + 1) / 2 * innerWidth}px, ${(1 - v.y) / 2 * innerHeight}px)`;
  tapHint.dataset.t = hintText(cur);
}

/* ================================================================== 拖出书页：书案上的小立像 */
// 出册后按住角色拖出书外，书案上留下一尊立像；原书里的它会重新从纸里冒出来
const deskFigs = [];
const DESK_SCALE = 0.62;
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), _hit = new THREE.Vector3();
function makeDeskFig(f) {
  const c = Object.create(f);  // 继承配置（形变代码、声音、头部参数…），换上自己的骨架与 uniform
  c.src = f; c.isDesk = true;
  c.u = { uTime: { value: 0 }, uSway: { value: 1 }, uLife: { value: 1 }, uEar: { value: 0 }, uHead: { value: new THREE.Vector2() },
    uQ: f.u.uQ, uQi: f.u.uQi, uPitchAxis: f.u.uPitchAxis };
  c.pivot = new THREE.Group(); c.squash = new THREE.Group(); c.fit = new THREE.Group();
  c.pivot.add(c.squash); c.squash.add(c.fit);
  c.headNow = new THREE.Vector2(); c.meshes = []; c.size = 1; c.hop = 0; c.lift = 1; c.nextEar = undefined;
  const root = f.root.clone(true);
  const srcMeshes = []; f.root.traverse((o) => o.isMesh && srcMeshes.push(o));
  let i = 0;
  root.traverse((o) => { if (o.isMesh) { const sm = srcMeshes[i++]; o.material = sm.material; o.userData = { qm: sm.userData.qm }; o.castShadow = true; patchBeastMesh(o, c); c.meshes.push(o); } });
  c.fit.add(root); c.fit.scale.setScalar(f.k); c.fit.position.copy(f.fitBase);
  c.pivot.scale.setScalar(DESK_SCALE);
  scene.add(c.pivot);
  deskFigs.push(c);
  return c;
}
function bookBounds() { // 打开的书在世界中的范围（书在面前时）
  return vol && (state === 'idle' || state === 'out') ? { x: PAGE_W + 0.12, z: PAGE_D / 2 + 0.1 } : null;
}
function overBook(p) { const bb = bookBounds(); return bb && Math.abs(p.x) < bb.x && Math.abs(p.z) < bb.z; }
function deskPoint(e, y = 0) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera); _plane.constant = -y;
  return ray.ray.intersectPlane(_plane, _hit) ? _hit.clone() : null;
}
function faceCamera(c) { c.pivot.rotation.y = Math.atan2(camera.position.x - c.pivot.position.x, camera.position.z - c.pivot.position.z) * 0.6; }
function pickDeskFig(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return deskFigs.find((c) => c.pivot.visible && ray.intersectObjects(c.meshes).length > 0) || null;
}
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  if (!['out', 'idle', 'closed'].includes(state) || acting) return;
  let target = pickDeskFig(e), kind = 'desk';
  if (!target && state === 'out') { const h = pick(e); if (h && h.beast) { target = h.beast; kind = 'book'; } }
  if (!target) return;
  e.stopImmediatePropagation(); // 不让镜头跟着转
  drag = { target, kind, x: e.clientX, y: e.clientY, moved: false, ghost: null };
  canvas.setPointerCapture(e.pointerId);
  if (kind === 'book' && cur.id === 'yinglong' && !acting) { const d = drag; d.holdT = setTimeout(() => { if (drag === d && !d.moved) { d.rain = true; holdRainStart(); } }, 220); }
}, { capture: true });
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (drag.rain) return; // 按住下雨时不拖动
  if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) return;
  clearTimeout(drag.holdT);
  const p = deskPoint(e, 0); if (!p) return;
  if (!drag.moved) {
    drag.moved = true; canvas.style.cursor = 'grabbing';
    if (drag.kind === 'book') { // 从书里拖出：先生成一尊立像跟着手走
      const f = drag.target;
      drag.ghost = deskFigs.find((c) => c.src === f) || makeDeskFig(f);
      drag.ghost.pivot.visible = true;
      f.pivot.visible = false; SFX.rustle(0.4, 0.3, 2600);
    }
  }
  const c = drag.kind === 'book' ? drag.ghost : drag.target;
  const lift = overBook(p) ? PT : 0;
  c.pivot.position.set(p.x, lift + 0.25 + (c.hover ? c.hover * DESK_SCALE : 0), p.z); // 提在手里，略微离地
  faceCamera(c);
}, { capture: true });
canvas.addEventListener('pointerup', async (e) => {
  if (!drag) return;
  const d = drag; drag = null; canvas.style.cursor = '';
  e.stopImmediatePropagation();
  if (d.rain) { d.rain = false; holdRainStop(); return; }
  clearTimeout(d.holdT);
  if (!d.moved) { // 只是点了一下：书里的角色 → 招牌动作；书案上的立像 → 跳一下
    if (d.kind === 'desk') hop(d.target); else if (state === 'out') tapFigure(d.target);
    return;
  }
  const c = d.kind === 'book' ? d.ghost : d.target, p = c.pivot.position.clone();
  if (overBook(p)) { // 放回书里
    await tween(0.35, (k) => { c.pivot.scale.setScalar(DESK_SCALE * (1 - k)); });
    removeDeskFig(c); SFX.rustle(0.5, 0.3); inkBloom(p.z, 1.0, 0.9);
    if (d.kind === 'book') d.target.pivot.visible = true;
    return;
  }
  // 落在书案上
  const y0 = c.pivot.position.y, y1 = c.hover ? c.hover * DESK_SCALE : 0;
  await tween(0.3, (k) => { c.pivot.position.y = y0 + (y1 - y0) * k; }, { e: ease.out });
  SFX.thump(0.3); voice(c, 0.12);
  if (d.kind === 'book') { // 书里的它重新冒出来
    const f = d.target; f.pivot.visible = true; f.squash.scale.z = 0.05;
    tween(0.8, (k) => { f.squash.scale.z = 0.05 + 0.95 * k; }, { e: ease.back });
  }
}, { capture: true });
function removeDeskFig(c) { scene.remove(c.pivot); deskFigs.splice(deskFigs.indexOf(c), 1); }
function updateDeskFigs(t, dt) {
  for (const c of deskFigs) {
    c.pivot.visible = holeK < 0.5;
    c.u.uTime.value = t;
    updateHead(c, dt); updateEar(c, t);
    c.fit.position.y = c.restY + (c.hop || 0);
    if (c.hover && (!drag || drag.ghost !== c && drag.target !== c)) c.pivot.position.y = c.hover * DESK_SCALE + Math.sin(t * 1.2 + c.k) * 0.03;
  }
}

/* ================================================================== 合影卡 */
const posterModal = $('posterModal'), importModal = $('importModal');
document.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => b.closest('.modal').classList.remove('on')));
function wrapText(g, text, x, y, maxW, lh, maxLines = 4) {
  const cjk = !/\s/.test(text.trim()); const units = cjk ? [...text] : text.split(' ');
  let line = '', n = 0;
  for (const u of units) {
    const test = line + (line && !cjk ? ' ' : '') + u;
    if (g.measureText(test).width > maxW && line) { g.fillText(line, x, y); y += lh; line = u; if (++n >= maxLines - 1) break; } else line = test;
  }
  if (line) g.fillText(line, x, y); return y + lh;
}
function makePoster() {
  renderer.render(scene, camera); // 截当前画面（不含页面上的按钮与文字）
  const src = renderer.domElement, W = 1080, H = 1440;
  const [c, g] = mk(W, H); paintPaper(g, W, H, 77, '#efe4cc');
  const ix = 56, iy = 56, iw = W - 112, ih = 820;
  const sa = src.width / src.height, ta = iw / ih;
  let sw = src.width, sh = src.height, sx = 0, sy = 0;
  if (sa > ta) { sw = sh * ta; sx = (src.width - sw) / 2; } else { sh = sw / ta; sy = (src.height - sh) / 2; }
  g.fillStyle = '#140f0c'; g.fillRect(ix, iy, iw, ih); g.drawImage(src, sx, sy, sw, sh, ix, iy, iw, ih);
  g.strokeStyle = 'rgba(42,36,32,.8)'; g.lineWidth = 3; g.strokeRect(ix - 10, iy - 10, iw + 20, ih + 20); g.lineWidth = 1; g.strokeRect(ix - 18, iy - 18, iw + 36, ih + 36);
  const reading = vol && (state === 'idle' || state === 'out');
  const n = reading && guests.length ? { h: [cur.name, ...guests.map((g) => g.name)].join(' × '), rows: [['合影', `${guests.map((g) => g.name).join('和')}走进了《${vol.title}》，和${cur.name}站在同一页上。`], ['出处', cur.note.src]] }
    : reading ? cur.note : { h: '书案', rows: [['陈列', deskFigs.length ? deskFigs.map((d) => d.name).join('、') + '，从书里走了出来。' : VOLUMES.map((v) => '《' + v.title + '》').join(' ')]] };
  let y = iy + ih + 110;
  g.fillStyle = '#2a2420'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.font = `76px ${BRUSH}`; g.fillText(n.h, 70, y);
  g.font = `28px ${SERIF}`; g.fillStyle = 'rgba(42,36,32,.6)'; g.fillText(reading ? `《${vol.title}》` : '出册 · 试阅本', 70, y + 50);
  y += 120; g.font = `30px ${SERIF}`;
  for (const [k, v] of n.rows.slice(0, 3)) {
    g.fillStyle = '#b23a2a'; g.fillText(k, 70, y);
    g.fillStyle = '#2a2420'; y = wrapText(g, v, 70 + g.measureText(k).width + 24, y, W - 260 - g.measureText(k).width, 46, 2) + 10;
  }
  // 印章与落款
  g.fillStyle = '#b23a2a'; g.fillRect(W - 186, H - 230, 116, 116);
  g.fillStyle = '#f6e6d2'; g.font = `52px ${BRUSH}`; g.textAlign = 'center'; g.fillText('出', W - 128, H - 178); g.fillText('册', W - 128, H - 124);
  g.textAlign = 'left'; g.font = `22px ${SERIF}`; g.fillStyle = 'rgba(42,36,32,.55)';
  const d = new Date(); g.fillText(`${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()} · 模型由 Aholo Lux3D 生成 · #Aholo黑客松`, 70, H - 70);
  return c.toDataURL('image/png');
}
$('photo').onclick = () => {
  SFX.initAudio(); SFX.pluck(392, 0.16);
  const url = makePoster(); $('posterImg').src = url; $('posterSave').href = url;
  posterModal.classList.add('on');
};

/* ================================================================== 导入模型：自己做一本 */
const glbInput = $('glbFile'), dropEl = $('drop'), importStatus = $('importStatus');
let importFile = null, userCount = 0;
$('import').onclick = () => openStudio();
function openImport() { importStatus.textContent = LUX3D.ready() ? '' : '试阅本暂未开放以照片塑形；现成的 GLB 模型可免费导入。'; importModal.classList.add('on'); }
glbInput.onchange = () => setImportFile(glbInput.files[0]);
['dragenter', 'dragover'].forEach((ev) => dropEl.addEventListener(ev, (e) => { e.preventDefault(); dropEl.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => dropEl.addEventListener(ev, (e) => { e.preventDefault(); dropEl.classList.remove('over'); }));
dropEl.addEventListener('drop', (e) => setImportFile(e.dataTransfer.files[0]));
function setImportFile(f) {
  if (!f) return;
  if (!/\.glb$/i.test(f.name) && !isImage(f)) { importStatus.textContent = '请上传照片（JPG / PNG / WebP）或 .glb 模型。'; return; }
  importFile = f; $('dropText').textContent = `${f.name} · ${(f.size / 1048576).toFixed(1)} MB`;
  if (!$('fName').value) $('fName').value = f.name.replace(/\.(glb|jpe?g|png|webp)$/i, '').replace(/[_-]?textured.*$/i, '').slice(0, 12) || '它';
  importStatus.textContent = isImage(f) ? (LUX3D.ready() ? '照片已选好，点「出册」后由 Lux3D 生成 3D（约一两分钟）。' : '照片生成 3D 需要部署中转服务；现在可先上传在 Lux3D 生成好的 GLB。') : f.size > 60 * 1048576 ? '文件较大，载入可能需要一些时间。' : '';
}
// 把模型正面渲染成插图（与 mountBeast 的对位方式一致：模型最大边 = 图版的 90%，居中）
function renderPlate(gltfScene) {
  const r2 = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  r2.setSize(1024, 1024, false); r2.outputColorSpace = THREE.SRGBColorSpace; r2.setClearColor(0, 0);
  const sc = new THREE.Scene(); const m = gltfScene.clone(true); sc.add(m); m.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(m), ce = b.getCenter(new THREE.Vector3()), sz = b.getSize(new THREE.Vector3());
  const W = Math.max(sz.x, sz.y), h = W / 1.8;
  const cam = new THREE.OrthographicCamera(-h, h, h, -h, -10 * W, 10 * W); cam.position.set(ce.x, ce.y, ce.z + 5 * W); cam.lookAt(ce);
  sc.add(new THREE.HemisphereLight(0xfff6e8, 0x8a7a66, 2.3)); const dl = new THREE.DirectionalLight(0xffffff, 1.4); dl.position.set(-1, 2, 3); sc.add(dl);
  r2.render(sc, cam);
  const [c, g] = mk(1024, 1024);
  paintPaper(g, 1024, 1024, 91, '#efe6d0');
  const gr = g.createRadialGradient(512, 512 + (sz.y / W) * 1024 * 0.45, 10, 512, 512 + (sz.y / W) * 1024 * 0.45, 300); // 脚下一抹淡影
  gr.addColorStop(0, 'rgba(120,96,60,.25)'); gr.addColorStop(1, 'rgba(120,96,60,0)'); g.fillStyle = gr; g.fillRect(0, 0, 1024, 1024);
  g.filter = 'drop-shadow(0 0 1.3px rgba(58,44,36,.95)) saturate(.9)'; g.drawImage(r2.domElement, 0, 0); g.filter = 'none';
  g.globalCompositeOperation = 'multiply'; g.globalAlpha = .08; g.drawImage(c, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  r2.dispose(); r2.forceContextLoss();
  return c;
}
function userCoverCanvas(title, name, plateCanvas, clothImg) {
  const W = 1049, H = 1426; const [c, g] = mk(W, H);
  g.drawImage(tintCanvas(clothImg, '#4c5e48', '#b9c4a6'), 0, 0, W, H);
  const gold = '#d9bd7c'; g.strokeStyle = gold; g.fillStyle = gold; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 3; g.strokeRect(70, 70, W - 140, H - 140);
  g.font = `600 84px ${SERIF}`; g.fillText(title, W / 2, 250);
  // 贴一张小插图（老书的“贴签插图”）
  const s = 520, x = (W - s) / 2, y = 420;
  g.fillStyle = '#efe6d0'; g.fillRect(x - 16, y - 16, s + 32, s + 32); g.drawImage(plateCanvas, x, y, s, s);
  g.strokeStyle = 'rgba(60,44,30,.6)'; g.lineWidth = 2; g.strokeRect(x - 8, y - 8, s + 16, s + 16);
  g.fillStyle = gold; g.font = `46px ${BRUSH}`; g.fillText(name, W / 2, 1080);
  g.font = `28px ${SERIF}`; g.fillText('出册 · 自制', W / 2, 1230);
  return c;
}
let looksCache = null;
// 正在装订新书：期间锁住书案，防止连点出两本、或半路翻开别的书
let making = false;
// 书案上只留一本「神笔 / 自制」新书：再做一本时，旧的那本飞走让位
const isExtra = (v) => /^vol-user/.test(v.id);
async function dropVolume(v) {
  await tween(0.6, (k) => { v.group.position.y = 3 * k * k; v.group.scale.setScalar(1 - 0.3 * k); }, { e: ease.io });
  scene.remove(v.group);
  const i = VOLUMES.indexOf(v); if (i >= 0) VOLUMES.splice(i, 1);
  (typeof MM_SAMPLES !== 'undefined' ? MM_SAMPLES : []).forEach((m) => { if (m.vol === v) m.vol = null; });
  selIdx = Math.min(selIdx, VOLUMES.length - 1); buildTags();
}
async function toDesk(ms = 40000) {
  if (state === 'out' || state === 'idle') closeBook();
  const t0 = performance.now();
  while (state !== 'closed') { if (performance.now() - t0 > ms) return false; await sleep(0.15); }
  return true;
}
async function makeUserBook(gltf, { name, desc, title, scene0 = 'none', sketch = null, origin = '原画' }) {
  making = true;
  try {
  for (const old of VOLUMES.filter(isExtra)) await dropVolume(old);
  gltf.scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(gltf.scene), sz = box.getSize(new THREE.Vector3()), ce = box.getCenter(new THREE.Vector3());
  const H = sz.y, y0 = box.min.y, f = (v) => v.toFixed(5);
  const plateCanvas = renderPlate(gltf.scene);
  const id = 'user' + (++userCount);
  const b = {
    id, fitW: 0.9, style: 'west', name, pageName: name, pageSub: '— 出自我的立绘书 —', nums: ['1', '2'],
    brand: `${title} · 第一页`, chapter: '', title: name, paras: [desc], gloss: '', glossKey: '\u0000',
    note: { h: name, rows: [['简介', desc], ['来源', sketch ? `${origin} → Aholo Lux3D 图生 3D` : '导入的 3D 模型（Lux3D 生成或外部修改后导入）']], src: `出自《${title}》`, stamp: sketch ? '神笔' : '自制' },
    sketch,
    voice: 'bells', scenery: scene0, acts: [],
    headC: [ce.x, y0 + H * 0.88, ce.z], restAz: 0, pitchAxis: [-1, 0, 0], yaw: [-0.35, 0.35], pitch: [-0.12, 0.12],
    plateImg: plateCanvas,
    glsl: /* glsl */`
      float headW(vec3 m){ return smoothstep(${f(y0 + H * 0.70)}, ${f(y0 + H * 0.82)}, m.y); }
      const vec3 NECK = vec3(${f(ce.x)}, ${f(y0 + H * 0.72)}, ${f(ce.z)});
      float earW(vec3 m){ return 0.0; }
      vec3 earPivot(vec3 m){ return m; }
      float earDir(vec3 m){ return 0.0; }
      vec3 bodyMove(vec3 m){
        vec3 o = m; float h = clamp((m.y - ${f(y0)}) / ${f(H)}, 0.0, 1.0);
        o.x += uSway * ${f(H * 0.012)} * sin(uTime * 1.1) * h * h;
        o.z += uSway * ${f(H * 0.008)} * cos(uTime * 0.9) * h * h;
        return o;
      }`,
  };
  const v = { id: 'vol-' + id, title, sub: sketch ? '神笔马良' : '自制 · 导入模型', hook: title === name ? (sketch ? '神笔马良' : '自制') : name, binding: 'left', gilt: false, beasts: [b], nums: ['1', '2'] };
  b.vol = v; VOLUMES.push(v); defineDesk(v);
  makeRig(b); prepPages(b, VOLUMES.length * 3);
  buildVolume(v, { cover: userCoverCanvas(title, name, plateCanvas, looksCache.cloth), cloth: tintCanvas(looksCache.cloth, '#4c5e48', '#b9c4a6') });
  mountBeast(b, gltf);
  b.pivot.visible = true; renderer.compile(scene, camera); b.pivot.visible = false;
  // 书案上让出位置，新书从上方落下
  const from = VOLUMES.map((x) => ({ x: x.group.position.x, z: x.group.position.z, r: x.group.rotation.y }));
  v.group.position.y = 3;
  SFX.rustle(0.8, 0.3);
  await Promise.all([
    ...VOLUMES.map((x, i) => { const to = deskPose(x); return tween(1.2, (k) => { x.group.position.x = from[i].x + (to.x - from[i].x) * k; x.group.position.z = from[i].z + (to.z - from[i].z) * k; x.group.rotation.y = from[i].r + (to.ry - from[i].r) * k; }, { e: ease.io }); }),
    tween(1.2, (k) => { v.group.position.y = 3 * (1 - k); }, { e: ease.out, delay: 0.3 }).then(() => { SFX.thump(0.4); SFX.sparkle(0.6); }),
    flyTo('closed', 1.4),
  ]);
  selIdx = VOLUMES.indexOf(v); buildTags(); deskUI();
  await sleep(0.4);
  making = false; await openBook();
  return v;
  } finally { making = false; }
}
$('importForm').onsubmit = async (e) => {
  e.preventDefault();
  if (!importFile) { importStatus.textContent = '请先选择一张照片或一个 .glb 模型。'; return; }
  if (making) { importStatus.textContent = '上一本还在装订，请稍候。'; return; }
  const name = ($('fName').value || '它').trim(), desc = ($('fDesc').value || `${name}从书页里站了起来。`).trim();
  const title = ($('fTitle').value || '我的立绘书').trim(), scene0 = $('fScene').value;
  const go = $('importGo'); go.disabled = true;
  try {
    setProg(importModal, isImage(importFile) ? '提交照片给 Lux3D…' : '读取模型…', null);
    const sketchUrl = isImage(importFile) ? URL.createObjectURL(importFile) : null;
    const gltf = await fileToGltf(importFile, (t, k) => setProg(importModal, t, k));
    setProg(importModal, '', null);
    let meshes = 0; gltf.scene.traverse((o) => o.isMesh && meshes++);
    if (!meshes) throw new Error('这个文件里没有找到网格。');
    setProg(importModal, '渲染插图、排版书页…', null);
    await sleep(0.05);
    importModal.classList.remove('on'); importFile = null; $('dropText').textContent = '点击选择或拖入照片 / .glb 模型'; glbInput.value = '';
    ['fName', 'fDesc', 'fTitle'].forEach((k) => { if ($(k)) $(k).value = ''; }); setProg(importModal, '', null);
    if (!(await toDesk())) return;
    await makeUserBook(gltf, { name, desc, title, scene0, sketch: sketchUrl });
  } catch (err) {
    console.error(err);
    setProg(importModal, '没能完成：' + (err && err.message ? err.message : err), null);
  } finally { go.disabled = false; }
};

/* ================================================================== 带我进书：用户的 3D 形象走进书页，和角色合影 */
const guests = [];
function sceneBox() { const box = standingBox(cur); guests.forEach((g) => box.union(new THREE.Box3().setFromObject(g.fit))); return box; }
// 爱心粒子
const HEARTS = 120;
const heartGeo = new THREE.BufferGeometry(); heartGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(HEARTS * 3), 3));
const heartTex = (() => { const [c, g] = mk(64, 64); g.fillStyle = '#ff6f8f'; g.beginPath(); g.moveTo(32, 54);
  g.bezierCurveTo(4, 34, 8, 8, 32, 20); g.bezierCurveTo(56, 8, 60, 34, 32, 54); g.fill(); return new THREE.CanvasTexture(c); })();
const hearts = new THREE.Points(heartGeo, new THREE.PointsMaterial({ size: 0.16, map: heartTex, transparent: true, depthWrite: false, alphaTest: 0.1 }));
hearts.frustumCulled = false; scene.add(hearts);
const heartList = [];
function spawnHearts(n, at) { for (let i = 0; i < n; i++) { if (heartList.length >= HEARTS) heartList.shift(); heartList.push({ p: at.clone().add(new THREE.Vector3((Math.random() - .5) * .25, Math.random() * .1, (Math.random() - .5) * .25)), v: new THREE.Vector3((Math.random() - .5) * .35, .55 + Math.random() * .4, (Math.random() - .5) * .2), age: 0, life: 1.6 + Math.random() }); } }
function updateHearts(dt) {
  const P = heartGeo.attributes.position.array; let n = 0;
  for (let i = heartList.length - 1; i >= 0; i--) { const h = heartList[i]; h.age += dt; if (h.age > h.life) { heartList.splice(i, 1); continue; } h.p.addScaledVector(h.v, dt); h.p.x += Math.sin(h.age * 4 + i) * 0.003; P.set([h.p.x, h.p.y, h.p.z], n * 3); n++; }
  heartGeo.setDrawRange(0, n); heartGeo.attributes.position.needsUpdate = true;
}
// 把一个导入的模型做成“客人”：通用的轻微摆动 + 头部跟随，站在右页上
function genericGlsl(box) {
  const sz = box.getSize(new THREE.Vector3()), ce = box.getCenter(new THREE.Vector3()), H = sz.y, y0 = box.min.y, f = (v) => v.toFixed(5);
  return { headC: [ce.x, y0 + H * 0.9, ce.z], glsl: /* glsl */`
    float headW(vec3 m){ return smoothstep(${f(y0 + H * 0.74)}, ${f(y0 + H * 0.84)}, m.y); }
    const vec3 NECK = vec3(${f(ce.x)}, ${f(y0 + H * 0.78)}, ${f(ce.z)});
    float earW(vec3 m){ return 0.0; }
    vec3 earPivot(vec3 m){ return m; }
    float earDir(vec3 m){ return 0.0; }
    vec3 bodyMove(vec3 m){ vec3 o = m; float h = clamp((m.y - ${f(y0)}) / ${f(H)}, 0.0, 1.0);
      o.x += uSway * ${f(H * 0.006)} * sin(uTime * 1.2) * h * h; return o; }` };
}
async function addGuest(gltf, name, slot) {
  gltf.scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(gltf.scene), sz = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
  const gg = genericGlsl(box);
  const g = { id: 'guest' + Date.now() + slot, name, isGuest: true, voice: 'bells', fitW: 1, restAz: 0, pitchAxis: [-1, 0, 0], yaw: [-0.45, 0.45], pitch: [-0.12, 0.15], ...gg, vol };
  makeRig(g);
  const H = Math.min(1.9, Math.max(1.25, cur.H * 1.0));               // 与书中角色相称的身高
  g.k = H / sz.y; g.H = H; g.Wd = sz.x * g.k;
  g.fit.scale.setScalar(g.k); g.fit.position.set(-ctr.x * g.k, -box.min.y * g.k, -ctr.z * g.k);
  g.restY = g.fit.position.y; g.fitBase = g.fit.position.clone();
  const right = Math.max(...figs(cur).map((f) => f.pivotX + f.Wd / 2));
  g.homeX = Math.min(PAGE_W - 0.3, right + 0.15 + g.Wd / 2 + slot * 0.95); g.homeZ = cur.pivotZ - 0.05;
  g.pivot.position.set(g.homeX, PT + 0.004, g.homeZ);
  const anim = gltf.animations && gltf.animations.length; // 绑了骨骼、带动作的模型：直接播它自己的动作，不加形变着色器
  gltf.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (anim) { o.frustumCulled = false; if (o.material.envMapIntensity !== undefined) o.material.envMapIntensity = 0.6; } else patchBeastMesh(o, g); g.meshes.push(o); } });
  g.root = gltf.scene; g.fit.add(gltf.scene); vol.group.add(g.pivot);
  if (anim) { g.mixer = new THREE.AnimationMixer(gltf.scene); const act = g.mixer.clipAction(gltf.animations[0]); act.time = Math.random() * 0.5; act.play(); }
  g.pivot.rotation.x = -Math.PI / 2; g.squash.scale.z = 0.03; g.pivot.visible = true;
  renderer.compile(scene, camera);
  guests.push(g);
  SFX.rise();
  await Promise.all([
    tween(1.4, (k) => { g.pivot.rotation.x = -Math.PI / 2 * (1 - k); }, { e: ease.back }),
    tween(1.1, (k) => { g.squash.scale.z = 0.03 + 0.97 * k; }, { e: ease.out, delay: 0.1 }),
    tween(1.2, (k) => { g.u.uSway.value = k; g.u.uLife.value = k; }, { delay: 0.8 }),
  ]);
  SFX.thump(0.3); inkBloom(g.homeZ, 1.2, 1.2);
}

// 画地为牢：毛笔在书页上画一个圈，圈上长出墨色栏杆，合成一座笼；两人靠在一起，朱印落下
const INK = { gold: [205, 152, 48], pink: [232, 122, 150] };
let inkColor = 'gold';
function brushRing(R) {
  const S = 512, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const ctx = cv.getContext('2d'), tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const seed = Math.random() * 10, a0 = -Math.PI * 0.62;
  const draw = (k) => {
    ctx.clearRect(0, 0, S, S);
    const end = a0 + Math.PI * 2.08 * k, r0 = S * 0.42;
    for (let a = a0; a < end; a += 0.006) {
      const t = (a - a0) / (Math.PI * 2.08);
      const w = S * (0.022 + 0.012 * Math.sin(a * 3 + seed) + 0.01 * Math.sin(a * 11 + seed * 2)) * (t < 0.04 ? t / 0.04 : t > 0.93 ? Math.max(0.15, (1 - t) / 0.07) : 1);
      const rr = r0 * (1 + 0.025 * Math.sin(a * 2 + seed) + (t > 0.93 ? 0.04 * (t - 0.93) / 0.07 : 0));
      const x = S / 2 + Math.cos(a) * rr, y = S / 2 + Math.sin(a) * rr;
      const [ir, ig, ib] = INK[inkColor] || INK.gold, sh = 0.85 + 0.3 * Math.sin(a * 17 + seed);
      ctx.fillStyle = `rgba(${Math.min(255, ir * sh) | 0},${Math.min(255, ig * sh) | 0},${Math.min(255, ib * sh) | 0},${0.2 + 0.1 * Math.sin(a * 23 + seed)})`;
      for (let j = 0; j < 3; j++) { ctx.beginPath(); ctx.arc(x + (Math.random() - .5) * w * .5, y + (Math.random() - .5) * w * .5, w * (0.45 + Math.random() * 0.25), 0, 7); ctx.fill(); }
    }
    tex.needsUpdate = true;
  };
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(R * 2 / 0.84, R * 2 / 0.84), mat); mesh.rotation.x = -Math.PI / 2;
  return { mesh, draw, mat };
}

// 金色鸟笼立绘：优先用手绘素材 SCENE_IMG.cage_gold（透明 PNG/WebP），没有就用画布画一张
function cageTexture(which = 'front') {
  const im = SCENE_IMG['cage_' + which];
  if (im) { const t = new THREE.Texture(im); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.needsUpdate = true; return { tex: t, aspect: im.height / im.width }; }
  const W = 512, H = 680, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d');
  const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#fff2b0'); g.addColorStop(0.35, '#e8b94a'); g.addColorStop(0.6, '#b98322'); g.addColorStop(0.8, '#f3d27a'); g.addColorStop(1, '#a8701a');
  const L = 48, Rr = W - 48, base = 640, shoulder = 250, apex = 70, N = 13;
  const stroke = (w, path) => { c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = '#4a2f08'; c.lineWidth = w + 5; c.beginPath(); path(); c.stroke(); c.strokeStyle = g; c.lineWidth = w; c.beginPath(); path(); c.stroke(); };
  for (let i = 0; i < N; i++) { // 竖条：直上肩部，再弯向顶心
    const x = L + (Rr - L) * i / (N - 1);
    stroke(6, () => { c.moveTo(x, base); c.lineTo(x, shoulder); c.quadraticCurveTo(x, apex + (shoulder - apex) * 0.15, W / 2, apex); });
  }
  stroke(14, () => { c.moveTo(L - 14, base); c.lineTo(Rr + 14, base); });               // 底座
  stroke(8, () => { c.moveTo(L - 6, base - 34); c.lineTo(Rr + 6, base - 34); });
  stroke(9, () => { c.moveTo(L - 4, 430); c.lineTo(Rr + 4, 430); });                      // 腰带
  stroke(8, () => { c.moveTo(L, shoulder); c.lineTo(Rr, shoulder); });                    // 肩带
  for (let x = L + 20; x < Rr - 10; x += 38) stroke(4, () => { c.arc(x + 9, 430 + 14, 9, Math.PI, 0); }); // 腰带卷草
  stroke(7, () => { c.arc(W / 2, apex - 26, 22, 0, Math.PI * 2); });                      // 顶环
  stroke(6, () => { c.moveTo(W / 2, apex); c.lineTo(W / 2, apex - 4); });
  // 心形锁
  const hx = W / 2, hy = 470; c.fillStyle = '#c0392b'; c.strokeStyle = '#4a2f08'; c.lineWidth = 3;
  c.beginPath(); c.moveTo(hx, hy + 30); c.bezierCurveTo(hx - 40, hy, hx - 26, hy - 30, hx, hy - 12); c.bezierCurveTo(hx + 26, hy - 30, hx + 40, hy, hx, hy + 30); c.fill(); c.stroke();
  c.fillStyle = '#ffd77a'; c.beginPath(); c.arc(hx, hy - 2, 5, 0, 7); c.fill();
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return { tex: t, aspect: H / W };
}
function sealTex(text) {
  const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S; const c = cv.getContext('2d');
  c.fillStyle = '#b23a2a'; c.beginPath(); c.roundRect(10, 10, S - 20, S - 20, 18); c.fill();
  c.strokeStyle = 'rgba(255,235,215,.85)'; c.lineWidth = 6; c.strokeRect(26, 26, S - 52, S - 52);
  c.fillStyle = '#f8ead8'; c.font = `${S * 0.33}px "Ma Shan Zheng","STKaiti","KaiTi",serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
  // 印文右起竖读：右列「画地」，左列「为牢」
  [[text[0], 0.68, 0.33], [text[1], 0.68, 0.69], [text[2], 0.32, 0.33], [text[3], 0.32, 0.69]].forEach(([ch, x, y]) => c.fillText(ch, S * x, S * y));
  const g = c.getImageData(0, 0, S, S); for (let i = 0; i < g.data.length; i += 4) if (Math.random() < 0.05) g.data[i + 3] *= 0.4; c.putImageData(g, 0, 0); // 印泥斑驳
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
Object.assign(ACTS, {
  async cage() {
    const [a, b] = pairFor(), A = moveable(a), B = moveable(b);
    hideActs();
    const cx = (A.x0 + B.x0) / 2, cz = (a.pivot.position.z + b.pivot.position.z) / 2;
    const R = Math.max(0.55, (B.x0 - A.x0) / 2 + Math.max(a.Wd, b.Wd) * 0.5 + 0.12), H = Math.max(a.H, b.H) * 1.12;
    const grp = new THREE.Group(); grp.position.set(cx, PT + 0.004, cz); vol.group.add(grp);
    // 1 画地：一笔画圈
    const ring = brushRing(R); grp.add(ring.mesh);
    SFX.rustle(0.5, 0.35); SFX.wind && SFX.wind(1.2, 0.08);
    await tween(1.4, (k) => ring.draw(k), { e: ease.io });
    { const [ir, ig, ib] = INK[inkColor] || INK.gold; spawnMotes(36, new THREE.Vector3(cx, PT + 0.05, cz), { spread: R * 0.9, vel: [0, 0.35, 0], jitter: 0.3, color: `rgb(${ir},${ig},${ib})`, life: 1.2, grav: -0.1, drag: 0.5 }); }
    // 2 为牢：金色鸟笼立绘从书页折起（前片在两人前，压暗的后片在身后）
    const F = cageTexture('front'), Bk = SCENE_IMG.cage_back ? cageTexture('back') : F, aspect = F.aspect, tex = F.tex;
    const cw = Math.max(R * 2.05, (H * 1.12 / aspect)), ch = cw * aspect;
    const mkCard = (dark) => {
      const T = dark ? Bk : F, h = cw * T.aspect, geo = new THREE.PlaneGeometry(cw, h); geo.translate(0, h / 2, 0);
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: T.tex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.35, envMapIntensity: 1.1, color: dark ? (Bk === F ? 0x7a6040 : 0xc9b48c) : 0xffffff }));
      m.castShadow = true; m.rotation.x = dark ? -Math.PI / 2 : Math.PI / 2; return m; // 平躺时朝外
    };
    const back = mkCard(true), front = mkCard(false);
    back.position.set(0, 0.002, -R * 0.62); back.scale.setScalar(0.94); front.position.set(0, 0.004, R * 0.62);
    grp.add(back, front);
    SFX.rustle(0.4, 0.3);
    await tween(0.7, (k) => { back.rotation.x = -Math.PI / 2 * (1 - k); }, { e: ease.back });
    SFX.pluck(392, 0.2);
    await tween(0.75, (k) => { front.rotation.x = Math.PI / 2 * (1 - k); }, { e: ease.back });
    SFX.bells(0.22);
    spawnMotes(40, new THREE.Vector3(cx, PT + ch * 0.75, cz + R * 0.62), { spread: cw * 0.4, vel: [0, 0.25, 0], jitter: 0.5, color: '#ffd36e', life: 1.4, grav: -0.2, drag: 0.4 });
    const cardsDown = () => Promise.all([
      tween(0.7, (k) => { front.scale.y = Math.max(0.001, 1 - k); front.material.opacity = 1 - k * 0.6; }, { e: ease.io }),
      tween(0.7, (k) => { back.scale.y = Math.max(0.001, 0.94 * (1 - k)); back.material.opacity = 1 - k * 0.6; }, { e: ease.io, delay: 0.12 }),
    ]);
    // 3 心甘情愿：两人靠在一起
    const gap = (B.x0 - A.x0) - (a.Wd + b.Wd) * 0.36, step = Math.max(0, gap) / 2;
    await tween(0.8, (k) => { A.p.x = A.x0 + step * k; B.p.x = B.x0 - step * k; A.r.z = -0.1 * k; B.r.z = 0.1 * k; }, { e: ease.io });
    SFX.boop(); spawnHearts(16, new THREE.Vector3(cx, PT + Math.min(a.H, b.H) * 0.85, cz + 0.15));
    // 4 朱印落下
    const seal = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.46), new THREE.MeshStandardMaterial({ map: sealTex('画地为牢'), transparent: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -3 }));
    seal.rotation.set(-Math.PI / 2, 0, 0.08);
    const sx = Math.min(PAGE_W - 0.3, cx + R + 0.32), sz = cz + R * 0.45;
    vol.group.add(seal); seal.position.set(sx, PT + 0.6, sz); seal.scale.setScalar(1.6);
    await tween(0.35, (k) => { seal.position.y = PT + 0.006 + 0.6 * (1 - k) * (1 - k); seal.scale.setScalar(1.6 - 0.6 * k); }, { e: (t) => t });
    SFX.thump(0.45); spawnMotes(24, new THREE.Vector3(sx, PT + 0.02, sz), { spread: 0.2, vel: [0, 0.3, 0], jitter: 0.6, color: '#b23a2a', life: 0.6, grav: 1.5, drag: 0.5 });
    showQuote('画地为牢', '', 5.5);
    await sleep(4.2);
    setTimeout(() => spawnHearts(8, new THREE.Vector3(cx, PT + Math.min(a.H, b.H) * 0.9, cz + 0.15)), 100);
    await sleep(0.8);
    // 5 收：栏杆沉回纸面，墨圈淡去，印留下一会儿
    await Promise.all([
      tween(0.9, (k) => { A.p.x = A.x0 + step * (1 - k); B.p.x = B.x0 - step * (1 - k); A.r.z = -0.1 * (1 - k); B.r.z = 0.1 * (1 - k); }, { e: ease.io }),
      cardsDown(),
      tween(1.6, (k) => { ring.mat.opacity = 1 - k; }, { delay: 0.8 }),
    ]);
    vol.group.remove(grp); ring.mat.map.dispose(); F.tex.dispose(); if (Bk !== F) Bk.tex.dispose();
    setTimeout(() => { tween(1, (k) => { seal.material.opacity = 1 - k; }).then(() => vol.group.remove(seal)); }, 2500);
    showActs(cur);
  },
});

// 机器人之梦：两人本来就是坐姿，书页上先折起一张沙发，再请他们坐上去
let sofaObj = null;
async function placeSofa(gs) {
  const g = await fetchModel('sofa', () => {}).catch(() => null); if (!g) return;
  const root = g.scene; root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material.envMapIntensity !== undefined) o.material.envMapIntensity = 0.6; } });
  root.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(root), sz = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
  const H = Math.max(...gs.map((x) => x.H)), k = (0.3 * H) / (0.46 * sz.y);   // 座面高 ≈ 坐姿臀部高度
  const W = sz.x * k, D = sz.z * k;
  const cx = Math.max(W / 2 + 0.08, Math.min(PAGE_W - W / 2 - 0.05, gs.reduce((a, x) => a + x.homeX, 0) / gs.length)), cz = gs[0].homeZ - D * 0.18;
  const hinge = new THREE.Group(); hinge.position.set(cx, PT + 0.004, cz - D / 2); vol.group.add(hinge);
  root.scale.setScalar(k); root.position.set(-c.x * k, -bb.min.y * k, -c.z * k + D / 2); hinge.add(root);
  hinge.rotation.x = -Math.PI / 2; sofaObj = hinge;
  renderer.compile(scene, camera);
  SFX.rustle(0.6, 0.3);
  // 两人挪到座位上
  const seats = [cx - W * 0.21, cx + W * 0.21], z = cz + D * 0.42; // 坐在坐垫前沿，脚垂在沙发前
  await Promise.all([
    tween(0.9, (q) => { hinge.rotation.x = -Math.PI / 2 * (1 - q); }, { e: ease.back }),
    ...gs.map((x, i) => { const x0 = x.pivot.position.x, z0 = x.pivot.position.z; return tween(0.8, (q) => { x.pivot.position.x = x0 + (seats[i] - x0) * q; x.pivot.position.z = z0 + (z - z0) * q; }, { e: ease.io, delay: 0.5 }); }),
  ]);
  gs.forEach((x, i) => { x.homeX = seats[i]; x.homeZ = z; });
  SFX.thump(0.25);
}
async function removeSofa() {
  const h = sofaObj; if (!h) return; sofaObj = null;
  await tween(0.6, (q) => { h.rotation.x = -Math.PI / 2 * q; }, { e: ease.io });
  vol.group.remove(h);
}
let pairCP = false; // 当前两位客人是否是一对（可「画地为牢」）
async function removeGuests() {
  pairCP = false; removeSofa();
  if (!guests.length) return;
  const list = guests.splice(0);
  await Promise.all(list.map((g) => tween(0.8, (k) => { g.pivot.rotation.x = -Math.PI / 2 * k; g.squash.scale.z = 1 - 0.97 * k; g.u.uLife.value = 1 - k; }, { e: ease.io })));
  list.forEach((g) => vol.group.remove(g.pivot));
}
function updateGuests(t, dt) {
  for (const g of guests) {
    g.u.uTime.value = t; updateHead(g, dt);
    if (g.mixer) g.mixer.update(dt);
    g.fit.position.y = g.restY + (g.hop || 0);
  }
}
// 两个角色之间的“相对动作”：A 向 B 靠近 / 探身，只用位移和倾斜，不需要骨骼
function pairFor() {
  const main = cur.companions && cur.companions.length && !guests[1] ? cur.companions[0] : cur;
  return guests.length > 1 ? [guests[0], guests[1]] : [main, guests[0]];
}
function moveable(f) { return { p: f.pivot.position, r: f.squash.rotation, x0: f.pivot.position.x, z0: f.squash.rotation.z }; }
Object.assign(ACTS, {
  async nuzzle() { // 贴贴
    const [a, b] = pairFor(), A = moveable(a), B = moveable(b);
    const gap = (B.x0 - A.x0) - (a.Wd + b.Wd) * 0.38, step = Math.max(0, gap) / 2;
    SFX.rustle(0.4, 0.2);
    await tween(0.9, (k) => { A.p.x = A.x0 + step * k; B.p.x = B.x0 - step * k; A.r.z = -0.12 * k; B.r.z = 0.12 * k; }, { e: ease.io });
    SFX.boop(); spawnHearts(14, new THREE.Vector3((A.p.x + B.p.x) / 2, PT + Math.min(a.H, b.H) * 0.8, (a.pivot.position.z + b.pivot.position.z) / 2 + 0.2));
    await tween(0.25, (k) => { A.r.z = -0.12 - 0.05 * Math.sin(k * Math.PI); B.r.z = 0.12 + 0.05 * Math.sin(k * Math.PI); });
    await sleep(1.1);
    setTimeout(() => spawnHearts(6, new THREE.Vector3((A.p.x + B.p.x) / 2, PT + Math.min(a.H, b.H) * 0.9, a.pivot.position.z + 0.2)), 200);
    await tween(0.9, (k) => { A.p.x = A.x0 + step * (1 - k); B.p.x = B.x0 - step * (1 - k); A.r.z = -0.12 * (1 - k); B.r.z = 0.12 * (1 - k); }, { e: ease.io });
  },
  async hifive() { // 击掌
    const [a, b] = pairFor(), A = moveable(a), B = moveable(b);
    const gap = (B.x0 - A.x0) - (a.Wd + b.Wd) * 0.45, step = Math.max(0, gap) / 2;
    await tween(0.35, (k) => { A.r.z = 0.08 * k; B.r.z = -0.08 * k; }, { e: ease.out }); // 先往后蓄力
    await tween(0.22, (k) => { A.p.x = A.x0 + step * k; B.p.x = B.x0 - step * k; A.r.z = 0.08 - 0.3 * k; B.r.z = -0.08 + 0.3 * k; }, { e: (t) => t * t });
    SFX.clap();
    const at = new THREE.Vector3((A.p.x + B.p.x) / 2, PT + Math.min(a.H, b.H) * 0.72, (a.pivot.position.z + b.pivot.position.z) / 2 + 0.15);
    spawnMotes(50, at, { spread: 0.08, vel: [0, 0.4, 0], jitter: 2.2, color: '#ffd36e', life: 0.7, grav: 2, drag: 0.6 });
    spawnMotes(20, at, { spread: 0.05, vel: [0, 0.2, 0], jitter: 1.0, color: '#ffffff', life: 0.4 });
    a.hop = 0; await tween(0.5, (k) => { A.r.z = -0.22 * (1 - k); B.r.z = 0.22 * (1 - k); A.p.x = A.x0 + step * (1 - k); B.p.x = B.x0 - step * (1 - k); }, { e: ease.back });
    voice(b.isGuest ? a : b, 0.12);
  },
  async snap() { // 拍合影：转到正面、闪光、生成双人合影卡
    note.classList.remove('on'); hideActs();
    await flyTo('snap', 1.2);
    await sleep(0.4);
    SFX.shutter(); const fl = $('flash'); fl.classList.add('on'); setTimeout(() => fl.classList.remove('on'), 120);
    await sleep(0.25);
    const url = makePoster(); $('posterImg').src = url; $('posterSave').href = url; posterModal.classList.add('on');
    showActs(cur); note.classList.add('on');
  },
  async leave() { await removeGuests(); showActs(cur); flyTo('beast', 1.2); },
});

// 上传：「我」和「朋友」（可选）。照片 → 3D 走 Lux3D API；GLB 直接载入
const joinModal = $('joinModal'), joinStatus = $('joinStatus');
const joinFiles = { me: null, friend: null };
function openJoin() { joinStatus.textContent = LUX3D.ready() ? '' : '试阅本暂未开放以照片塑形；现成的 GLB 模型可免费上传。'; joinModal.classList.add('on'); }
['me', 'friend'].forEach((who) => {
  const inp = $('join_' + who), zone = inp.closest('.drop'), label = zone.querySelector('span');
  const set = (f) => {
    if (!f) return; joinFiles[who] = f;
    label.textContent = `${f.name} · ${(f.size / 1048576).toFixed(1)} MB`;
    joinStatus.textContent = isImage(f) ? (LUX3D.ready() ? '照片已选好，点「走进书里」后由 Lux3D 生成 3D（约一两分钟）。' : '照片生成 3D 需要部署中转服务；现在可先上传在 Lux3D 生成好的 GLB。') : '';
  };
  inp.onchange = () => set(inp.files[0]);
  ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('over'); }));
  zone.addEventListener('drop', (e) => set(e.dataTransfer.files[0]));
});
// Lux3D：照片 → 3D。浏览器只和我们自己的中转服务通信（/api/…），API Key 留在服务器上
const LUX3D = {
  _ok: false,
  remaining: 0,
  async init() { try { const r = await fetch('./api/health', { cache: 'no-store' }); const j = r.ok ? await r.json() : {}; this._ok = !!j.ok; this.remaining = j.remaining ?? 0; } catch { this._ok = false; } return this._ok; },
  ready() { return this._ok; },
  async generate(file, onProgress = () => {}) {
    if (!this._ok) throw new Error('照片直接生成 3D 需要部署中转服务（见 README）。现在可以先导入在 Lux3D 生成好的 GLB。');
    onProgress('上传照片…', 'busy');
    const fd = new FormData(); fd.append('file', file);
    const r = await fetch('./api/gen', { method: 'POST', body: fd });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `提交失败（${r.status}）`);
    const { id } = await r.json();
    const t0 = Date.now();
    for (;;) {
      await sleep(2.5);
      const q = await (await fetch(`./api/gen/${id}`, { cache: 'no-store' })).json();
      if (q.status === 'failed') throw new Error('Lux3D 生成失败' + (q.error ? '：' + q.error : '') + '，可以换一张照片再试。');
      const sec = q.elapsed ?? Math.round((Date.now() - t0) / 1000);
      // 官方接口只给阶段，不给百分比：如实显示阶段与已等待时间
      onProgress(q.status === 'queued' ? `已提交给 Lux3D，排队中… ${sec} 秒` : q.status === 'succeeded' ? 'Lux3D 生成完成' : `Lux3D 正在把照片变成 3D… 已等待 ${sec} 秒`, 'busy');
      if (q.status === 'succeeded') break;
    }
    onProgress('下载模型…', 'busy');
    const m = await fetch(`./api/gen/${id}/model`);
    if (!m.ok) throw new Error('模型下载失败，请重试。');
    onProgress('塑成，即将出册', null);
    this.init();
    return m.arrayBuffer();
  },
};
const isImage = (f) => /\.(jpe?g|png|webp)$/i.test(f.name) || /^image\//.test(f.type);
function setProg(el, text, k) {
  const st = el.querySelector('.status'), bar = el.querySelector('.prog');
  if (st) st.textContent = text;
  if (bar) bar.classList.toggle('on', k === 'busy');
}
async function fileToGltf(f, onProgress) {
  let buf;
  if (/\.glb$/i.test(f.name)) buf = await f.arrayBuffer();
  else if (isImage(f)) buf = await LUX3D.generate(f, onProgress);
  else throw new Error('请上传 .glb 模型或照片');
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  return new Promise((ok, bad) => loader.parse(buf, '', ok, bad));
}
$('joinForm').onsubmit = async (e) => {
  e.preventDefault();
  if (!joinFiles.me) { joinStatus.textContent = '请先上传“我”的模型。'; return; }
  if (state !== 'out') { joinStatus.textContent = '请先让书里的角色出册。'; return; }
  const go = $('joinGo'); go.disabled = true;
  try {
    const list = [['me', ($('joinMeName').value || '我').trim()], ['friend', ($('joinFriendName').value || '朋友').trim()]].filter(([w]) => joinFiles[w]);
    const loaded = [];
    for (const [w, name] of list) { setProg(joinModal, `载入${name}…`, null); loaded.push([await fileToGltf(joinFiles[w], (t, k) => setProg(joinModal, `${name}：${t}`, k)), name]); }
    setProg(joinModal, '', null);
    joinModal.classList.remove('on'); hideActs(); note.classList.remove('on');
    await removeGuests();
    for (let i = 0; i < loaded.length; i++) await addGuest(loaded[i][0], loaded[i][1], i);
    pairCP = guests.length === 2;
    await flyTo('beast', 1.4);
    showActs(cur); note.classList.add('on');
  } catch (err) {
    console.error(err); setProg(joinModal, '没能完成：' + (err.message || err), null);
  } finally { go.disabled = false; }
};


/* ================================================================== 工坊：免费示例 / 照片生成（计额度）/ 价格方案 */
// 示例：照片 + 预先用 Lux3D 生成好的模型（base64 JSON）。演示版里随便玩，不调用生成接口。
// TODO：换成真实示例（assets/sample_*.jpg + sample_*.json）
// 每个示例是一对：代表「我」和「朋友」。TODO：换成真实示例（assets/sample_*.jpg + sample_*.json）
const SAMPLES = [
  { label: '示例 · 画地为牢', sub: '许飞 & 厉娜', thumb: 's1.jpg', cp: true, people: [{ name: '许飞', model: 's1b' }, { name: '厉娜', model: 's1a' }] },
  { label: '示例 · 机器人之梦', sub: '机器人 & 小狗', thumb: 's2.jpg', sofa: true, people: [{ name: '机器人', model: 's2a' }, { name: '小狗', model: 's2b' }] },
  { label: '示例 · 小王子与爱丽丝', sub: '两卷人物串门', thumb: 'plate_prince.jpg', people: [{ name: '小王子', model: 'm6c' }, { name: '爱丽丝', model: 'm4c' }] },
];
const studioModal = $('studioModal'), tapeEl = $('tape');
function studioTab(t) {
  document.querySelectorAll('.stabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  document.querySelectorAll('.studio .pane').forEach((p) => p.classList.toggle('on', p.dataset.pane === t));
  $('genNote').style.display = t === 'plan' ? 'none' : '';
}
document.querySelectorAll('.stabs button').forEach((b) => (b.onclick = () => studioTab(b.dataset.tab)));
function openStudio(tab) {
  const chip = $('inkChip'), ready = LUX3D.ready();
  chip.textContent = ready ? `余墨 ${LUX3D.remaining} 锭` : '试阅本';
  chip.classList.toggle('live', ready);
  const lock = !ready || LUX3D.remaining <= 0;
  [['genJoin', '每人一锭'], ['genBook', '一锭']].forEach(([id, c]) => { $(id).classList.toggle('locked', lock); $(id).querySelector('.cost').textContent = ready ? c : 'GLB 免费'; });
  $('genNote').textContent = ready
    ? (LUX3D.remaining > 0 ? '照片塑形约需一两分钟，每次耗墨一锭；上传现成的 GLB 模型不耗墨。' : '今日的墨已用尽。可先请现成的人物入书，或上传现成的 GLB 模型（不耗墨）。')
    : '试阅本暂未开放照片塑形，「＋」可导入现成的 GLB 模型。';
  studioTab(tab || 'join');
  studioModal.classList.add('on');
  LUX3D.init().then(() => { if (studioModal.classList.contains('on') && LUX3D.ready()) chip.textContent = `余墨 ${LUX3D.remaining} 锭`; });
}
(function buildSamples() {
  const box = $('samples'), pk = $('pickSamples');
  SAMPLES.forEach((g) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'card';
    b.innerHTML = `<img alt="" src="assets/${g.thumb}"><b>${g.label.replace(/^示例 · /, '')}</b><small>${g.sub || '照片 → Lux3D'}</small>`;
    b.onclick = () => enterSamples(g.people, g.cp, g.sofa); box.insertBefore(b, $('genJoin'));
    const c = document.createElement('button'); c.type = 'button'; c.className = 'pick';
    c.innerHTML = `<img alt="" src="assets/${g.thumb}"><span>${g.label.replace(/^示例 · /, '')}<small>${g.sub || ''}</small></span>`;
    c.onclick = () => { closePicker(); enterSamples(g.people, g.cp, g.sofa); }; pk.appendChild(c);
  });
})();
const pickerEl = $('picker');
function openPicker() {
  const ready = LUX3D.ready();
  $('pickMine').querySelector('small').textContent = ready ? `以照片塑形 · 余墨 ${LUX3D.remaining} 锭` : '照片塑形 · 正式开放后';
  pickerEl.classList.add('on');
}
function closePicker() { pickerEl.classList.remove('on'); }
$('pickMine').onclick = () => { closePicker(); openJoin(); };
$('pickMore').onclick = () => { closePicker(); openStudio(); };
async function ensureOut() {
  const t0 = performance.now();
  while (state !== 'out') {
    if (state === 'closed') openBook(); else if (state === 'idle') chuce();
    if (performance.now() - t0 > 40000) throw new Error('timeout');
    await sleep(0.15);
  }
}
let entering = false;
async function enterSamples(list, cp = false, sofa = false) {
  if (entering) return; entering = true;
  studioModal.classList.remove('on');
  try {
    const models = Promise.all(list.map((s) => fetchModel(s.model, () => {}).then((g) => ({ g, s })))); // 每次新载一份（材质各自打补丁）
    await ensureOut();
    hint.textContent = '正在走进书里…'; hint.style.opacity = 1;
    const loaded = await models;
    hint.style.opacity = 0;
    hideActs(); note.classList.remove('on');
    await removeGuests();
    // 同一模型可能已被用过：克隆一份场景
    for (let i = 0; i < loaded.length; i++) { const { g, s } = loaded[i]; await addGuest(g, s.name, i); }
    pairCP = cp && guests.length === 2;
    if (sofa && guests.length === 2) await placeSofa(guests);
    await flyTo('beast', 1.4);
    showActs(cur); note.classList.add('on');
  } catch (e) { console.error(e); }
  finally { entering = false; }
}
$('genJoin').onclick = async () => { studioModal.classList.remove('on'); await ensureOut().catch(() => {}); openJoin(); };
$('genBook').onclick = () => { studioModal.classList.remove('on'); openImport(); };


/* ------------------------------------------------------------------ 书案：书签与悬停抬起 */
const tagBox = $('deskTags');
let tagEls = [];
function buildTags() {
  tagBox.innerHTML = ''; tagEls = VOLUMES.map((v, i) => {
    const el = document.createElement('button'); el.className = 'tag';
    el.innerHTML = `<b>${v.title}</b><span>${v.hook || v.sub || ''}</span>`;
    el.onclick = () => { if (state !== 'closed') return; selIdx = i; openBook(); };
    el.onpointerenter = () => { if (state === 'closed' && selIdx !== i) { selIdx = i; deskUI(); setBusy(false); } };
    tagBox.appendChild(el); return el;
  });
}
const _tp = new THREE.Vector3();
let deskHover = false, peekIdx = -1, peekT = 0, nextPeek = 4, lastHoverIdx = -1;
function updateDesk(dt) {
  const closed = state === 'closed';
  if (closed) {
    peekT += dt; nextPeek -= dt;
    if (peekIdx >= 0 && peekT > 1.4) peekIdx = -1;
    if (nextPeek <= 0) { nextPeek = 4 + Math.random() * 3; if (!deskHover) { peekIdx = Math.floor(Math.random() * VOLUMES.length); peekT = 0; SFX.rustle(0.35, 0.08, 3600); } }
  }
  tagBox.classList.toggle('on', closed);
  if (tagEls.length !== VOLUMES.length) buildTags();
  VOLUMES.forEach((v, i) => {
    if (!v.group) return;
    const lift = closed && i === selIdx ? 0.16 : 0;
    v.group.position.y += (lift - v.group.position.y) * Math.min(1, dt * 8);
    if (closed) { // 封面掀开一条缝，漏出金光：悬停的那本，或没人操作时随机一本「偷看」
      const want = (i === selIdx && deskHover ? 0.07 : 0) + (peekIdx === i ? 0.11 * Math.sin(Math.min(1, peekT / 1.4) * Math.PI) : 0);
      v.peek = (v.peek || 0) + (want - (v.peek || 0)) * Math.min(1, dt * 6);
      setOpen(v, v.peek);
      if (v.peek > 0.025 && Math.random() < v.peek * 6) {
        const side = v.binding === 'right' ? 1 : -1;
        spawnMotes(1, v.hinge.localToWorld(new THREE.Vector3(side * PAGE_W * 0.96, -PT + 0.02, (Math.random() - 0.5) * PAGE_D * 0.9)), { spread: 0.04, vel: [0, 0.35, 0], jitter: 0.15, color: '#ffd77a', life: 1.3, grav: -0.15, drag: 0.4 });
      }
    }
    if (!closed) return;
    const tall = innerHeight > innerWidth;
    _tp.set(v.desk.x, 0.1, v.desk.z + PAGE_D / 2 + 0.3).project(camera);
    const el = tagEls[i];
    el.style.transform = `translate(-50%,0) translate(${((_tp.x + 1) / 2 * innerWidth).toFixed(1)}px,${((1 - _tp.y) / 2 * innerHeight).toFixed(1)}px)`;
    el.classList.toggle('sel', i === selIdx);
  });
}


/* ------------------------------------------------------------------ 书房：书案状态下的手绘背景（书房 + 桌子 + 台灯 + 星象仪） */
const studyEl = $('study'), stTable = $('stTable'), stLamp = $('stLamp'), stGlobe = $('stGlobe'), stGlow = $('stGlow'), stFloor = $('stFloor');
let studyK = 1;
function applyBack() {
  const k = Math.max(holeK, studyK);
  deskMat.opacity = 1 - k; desk.visible = k < 0.999;
  renderer.setClearAlpha(1 - k);
  scene.background = k > 0.001 ? null : BG;
  scene.fog = k > 0.001 ? null : FOG;
  studyEl.style.opacity = studyK;
}
// 桌面图（1600×501）里：桌旗中心约在 (790,140)，桌旗宽约 900；台灯、星象仪的底座落点
const TBL = { w: 1600, h: 501, cx: 790, cy: 150, span: 900 * 0.8 };
const _sp = new THREE.Vector3();
// 书房整图（1672×941）：皮革桌垫中心约 (835,650)，三本书横跨约 850px；同时保证整图铺满屏幕
const ROOM = { w: 1672, h: 941, cx: 835, cy: 652, span: 850 };
const roomMap = { s: 1, L: 0, T: 0 }, par = { x: 0, y: 0, tx: 0, ty: 0 };
// 拱窗里的星（图上坐标）
const STARS = [[690, 70], [760, 150], [905, 60], [980, 190], [1040, 95], [720, 260], [860, 230], [1010, 300], [800, 60], [940, 140], [670, 180], [1060, 240]];
(function () { const box = $('stStars'); STARS.forEach((p, i) => { const e = document.createElement('i'); e.style.setProperty('--d', (2.2 + (i % 5) * 0.7) + 's'); e.style.setProperty('--dl', (-i * 0.53) + 's'); box.appendChild(e); }); })();
const stRoom = $('stRoom');
function lampHit(x, y) { const ix = (x - roomMap.L) / roomMap.s, iy = (y - roomMap.T) / roomMap.s; return ix > 20 && ix < 360 && iy > 250 && iy < 600; }
let lampOff = false;
function toggleLamp() { lampOff = !lampOff; studyEl.classList.toggle('lampoff', lampOff); SFX.thump(0.12); SFX.pluck(lampOff ? 220 : 330, 0.08); tween(0.6, (k) => dimLights(lampOff ? k * 0.55 : 0.55 * (1 - k), 0xffcf8a)); }
function layoutStudy() {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  VOLUMES.forEach((v) => {
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      _sp.set(v.desk.x + dx * PAGE_W / 2, 0, v.desk.z + dz * PAGE_D / 2).project(camera);
      const X = (_sp.x + 1) / 2 * innerWidth, Y = (1 - _sp.y) / 2 * innerHeight;
      x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y);
    }
  });
  const s = Math.max((x1 - x0) / ROOM.span, innerWidth / ROOM.w, innerHeight / ROOM.h);
  const W = ROOM.w * s, H = ROOM.h * s;
  const L = Math.min(0, Math.max(innerWidth - W, (x0 + x1) / 2 - ROOM.cx * s)), T = Math.min(0, Math.max(innerHeight - H, (y0 + y1) / 2 - ROOM.cy * s));
  par.x += (par.tx - par.x) * 0.06; par.y += (par.ty - par.y) * 0.06; // 视差：背景随鼠标轻轻反向
  const PL = L - par.x * 14, PT2 = T - par.y * 9, sc = 1.02;
  stRoom.style.width = (W * sc).toFixed(1) + 'px'; stRoom.style.transform = `translate(${(PL - W * (sc - 1) / 2).toFixed(1)}px,${(PT2 - H * (sc - 1) / 2).toFixed(1)}px)`;
  roomMap.s = s * sc; roomMap.L = PL - W * (sc - 1) / 2; roomMap.T = PT2 - H * (sc - 1) / 2;
  const st = $('stStars').children; for (let i = 0; i < st.length; i++) st[i].style.transform = `translate(${(roomMap.L + STARS[i][0] * roomMap.s).toFixed(1)}px,${(roomMap.T + STARS[i][1] * roomMap.s).toFixed(1)}px)`;
}
function updateStudy(dt) {
  const target = state === 'closed' || state === 'loading' ? 1 : 0;
  studyK += (target - studyK) * Math.min(1, dt * 2.6);
  if (Math.abs(target - studyK) < 0.002) studyK = target;
  applyBack();
  if (studyK > 0.01) { layoutStudy(); updateSky(dt); updateFx(dt); }
  else if (tipEl.classList.contains('on')) showHotTip(null);
}

// 这一刻该放哪首曲子：书案放书房主题；翻开某卷，若该卷有自己的曲子就换上
function bgmTrack() { if (state === 'boss') return 'boss'; return state === 'closed' || state === 'loading' || !vol ? 'study' : ({ shanhai: 'shanhai', alice: 'alice', prince: 'prince' })[vol.id] || 'study'; }
/* ------------------------------------------------------------------ 书房里的小机关：流星、灯笼、浑天仪、花、指尖金粉 */
const SKY = { x: 630, y: 0, w: 460, h: 380 };                 // 窗区（图上坐标），流星只画在天空里（sky_mask）
const skyCv = $('stSky'), sg = skyCv.getContext('2d'), fxEl = $('stFx'), tipEl = $('stTip');
skyCv.width = SKY.w * 2; skyCv.height = SKY.h * 2;
const meteors = []; let nextMeteor = 2.5, wishing = false;
const toPx = (ix, iy) => [roomMap.L + ix * roomMap.s, roomMap.T + iy * roomMap.s];
function spawnMeteor(fast = false) {
  const fromLeft = Math.random() < 0.5, ang = (fromLeft ? 0.42 : Math.PI - 0.42) + (Math.random() - 0.5) * 0.3;
  const sp = (fast ? 520 : 380) + Math.random() * 220;
  meteors.push({ x: fromLeft ? Math.random() * SKY.w * 0.6 : SKY.w * (0.4 + Math.random() * 0.6), y: Math.random() * SKY.h * 0.35,
    vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, t: 0, life: 0.7 + Math.random() * 0.6, len: 60 + Math.random() * 70, w: 1 + Math.random() * 1.2 });
}
function updateSky(dt) {
  const [x, y] = toPx(SKY.x, SKY.y);
  skyCv.style.width = (SKY.w * roomMap.s).toFixed(1) + 'px';
  skyCv.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
  if (state === 'closed' && (nextMeteor -= dt) <= 0) { nextMeteor = 3 + Math.random() * 5; spawnMeteor(); }
  sg.setTransform(2, 0, 0, 2, 0, 0); sg.clearRect(0, 0, SKY.w, SKY.h);
  sg.globalCompositeOperation = 'lighter';
  for (let i = meteors.length - 1; i >= 0; i--) {
    const m = meteors[i]; m.t += dt; m.x += m.vx * dt; m.y += m.vy * dt;
    const k = m.t / m.life; if (k >= 1) { meteors.splice(i, 1); continue; }
    const a = Math.sin(Math.min(1, k) * Math.PI), sp = Math.hypot(m.vx, m.vy), tx = m.x - m.vx / sp * m.len, ty = m.y - m.vy / sp * m.len;
    const gr = sg.createLinearGradient(m.x, m.y, tx, ty);
    gr.addColorStop(0, `rgba(255,248,225,${0.95 * a})`); gr.addColorStop(0.25, `rgba(255,226,160,${0.45 * a})`); gr.addColorStop(1, 'rgba(255,210,140,0)');
    sg.strokeStyle = gr; sg.lineWidth = m.w; sg.lineCap = 'round'; sg.beginPath(); sg.moveTo(m.x, m.y); sg.lineTo(tx, ty); sg.stroke();
    const hg = sg.createRadialGradient(m.x, m.y, 0, m.x, m.y, 6 * m.w); hg.addColorStop(0, `rgba(255,250,235,${a})`); hg.addColorStop(1, 'rgba(255,230,180,0)');
    sg.fillStyle = hg; sg.beginPath(); sg.arc(m.x, m.y, 6 * m.w, 0, 7); sg.fill();
  }
  sg.globalCompositeOperation = 'source-over';
}
// 许愿：一阵流星雨，末了一颗落进某本书里——那本书掀开一角，漏出金光
async function wish() {
  if (wishing) return; wishing = true;
  whisper('流星划过，许个愿吧');
  SFX.bells(0.12); SFX.sparkle(0.8);
  for (let i = 0; i < 9; i++) { spawnMeteor(true); if (i % 3 === 2) SFX.pluck([987.77, 1174.66, 1318.51][i / 3 | 0], 0.05); await sleep(0.18 + Math.random() * 0.2); }
  await sleep(0.9);
  if (state === 'closed') {
    const i = Math.floor(Math.random() * VOLUMES.length);
    selIdx = i; deskUI(); peekIdx = i; peekT = 0; nextPeek = 5; SFX.rise && SFX.pluck(1567.98, 0.06);
    whisper(`一颗星落进了《${VOLUMES[i].title}》`);
  }
  await sleep(2); wishing = false;
}
function whisper(t) { hint.textContent = t; hint.style.opacity = 1; clearTimeout(whisper.t); whisper.t = setTimeout(() => { if (state === 'closed') hint.textContent = '每一本书，都有人等待你翻开'; }, 3200); }
// 装饰性小效果：都放进 #stFx，按图上坐标定位，结束自删
function fxAt(cls, ix, iy, html = '', life = 2600) {
  const e = document.createElement('div'); e.className = 'fx ' + cls; e.innerHTML = html; e.dataset.ix = ix; e.dataset.iy = iy;
  fxEl.appendChild(e); placeFx(e); setTimeout(() => e.remove(), life); return e;
}
function placeFx(e) { const [x, y] = toPx(+e.dataset.ix, +e.dataset.iy); e.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) scale(${roomMap.s.toFixed(3)})`; }
function updateFx() { for (const e of fxEl.children) placeFx(e); }
const lanternGlow = fxAt('lantern', 1110, 352, '', 1e12);
function flareLantern() { lanternGlow.classList.remove('flare'); void lanternGlow.offsetWidth; lanternGlow.classList.add('flare'); SFX.rustle(0.25, 0.06, 900); SFX.pluck(392, 0.05); tween(1.6, (k) => dimLights(-0.25 * Math.sin(k * Math.PI), 0xffb060)); }
function spinOrrery() { fxAt('orrery', 1372, 372, '<i></i><i></i><i></i>', 3200); [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => setTimeout(() => SFX.pluck(f, 0.06), i * 140)); }
function dropPetals() {
  SFX.rustle(0.4, 0.08, 4200);
  for (let i = 0; i < 12; i++) {
    const p = fxAt('petal', 590 + Math.random() * 120, 240 + Math.random() * 50, '<i></i>', 4200);
    p.firstChild.style.setProperty('--dx', (Math.random() * 120 - 60) + 'px'); p.firstChild.style.setProperty('--dy', (150 + Math.random() * 110) + 'px');
    p.firstChild.style.setProperty('--r', (Math.random() * 540 - 270) + 'deg'); p.firstChild.style.animationDelay = (Math.random() * 0.6) + 's';
  }
}
function glowJar() { fxAt('jar', 1375, 120, '', 2600); SFX.bells(0.12); }
const HOT = [
  { box: [20, 230, 360, 600], tip: () => (lampOff ? '开灯' : '关灯'), act: () => toggleLamp() },
  { box: [640, 0, 1085, 300], tip: () => '对流星许个愿', act: () => wish() },
  { box: [1070, 280, 1150, 425], tip: () => '拨亮灯笼', act: () => flareLantern() },
  { box: [1285, 290, 1470, 545], tip: () => '转动浑天仪', act: () => spinOrrery() },
  { box: [545, 220, 720, 330], tip: () => '碰一下花枝', act: () => dropPetals() },
  { box: [1335, 50, 1415, 185], tip: () => '玻璃罩里的花', act: () => glowJar() },
];
function hotAt(x, y) {
  const ix = (x - roomMap.L) / roomMap.s, iy = (y - roomMap.T) / roomMap.s;
  return HOT.find((h) => ix > h.box[0] && ix < h.box[2] && iy > h.box[1] && iy < h.box[3]) || null;
}
function showHotTip(h, x, y) {
  tipEl.classList.toggle('on', !!h);
  if (h) { tipEl.textContent = h.tip(); tipEl.style.transform = `translate(${x + 16}px,${y + 14}px)`; }
}
// 指尖金粉：在书房里移动时，指尖洒下一点点金屑
const dustCv = $('dust'), dg = dustCv.getContext('2d'), dust = []; let dustLast = 0;
function sizeDust() { const d = Math.min(2, devicePixelRatio || 1); dustCv.width = innerWidth * d; dustCv.height = innerHeight * d; dg.setTransform(d, 0, 0, d, 0, 0); }
addEventListener('resize', sizeDust); sizeDust();
function dustAt(x, y) {
  const now = performance.now(); if (now - dustLast < 28 || state !== 'closed') return; dustLast = now;
  for (let i = 0; i < 2; i++) dust.push({ x: x + (Math.random() - 0.5) * 8, y: y + (Math.random() - 0.5) * 8, vx: (Math.random() - 0.5) * 18, vy: -10 - Math.random() * 22, t: 0, life: 0.9 + Math.random() * 0.7, r: 0.8 + Math.random() * 1.4 });
}
function updateDust(dt) {
  dg.clearRect(0, 0, innerWidth, innerHeight); if (!dust.length) return;
  dg.globalCompositeOperation = 'lighter';
  for (let i = dust.length - 1; i >= 0; i--) {
    const p = dust[i]; p.t += dt; if (p.t > p.life) { dust.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 6 * dt;
    const a = (1 - p.t / p.life) * (0.6 + 0.4 * Math.sin(p.t * 20 + i));
    dg.fillStyle = `rgba(255,214,140,${a.toFixed(3)})`; dg.beginPath(); dg.arc(p.x, p.y, p.r, 0, 7); dg.fill();
  }
  dg.globalCompositeOperation = 'source-over';
}


/* ------------------------------------------------------------------ 封印狰：小 Boss 关 */
// 狰不肯好好出册：吼一声冲出图版，在书页上横冲直撞。玩家画一个圈把它圈住：圈越准，金笼落得越快；画歪、太大、没合上，它就挣脱再跑。
const pad = $('sealPad'), pctx = pad.getContext('2d'), hud = $('bossHud'), bossTimeEl = $('bossTime'), bossTip = $('bossTip'), bossRes = $('bossResult');
let boss = null, shakeK = 0, bossSeen = false, stroke = null;
function sizePad() { const d = Math.min(2, devicePixelRatio || 1); pad.width = innerWidth * d; pad.height = innerHeight * d; pctx.setTransform(d, 0, 0, d, 0, 0); }
addEventListener('resize', sizePad); sizePad();
const ARENA = { x0: -PAGE_W + 0.5, x1: PAGE_W - 0.5, z0: -PAGE_D / 2 + 0.6, z1: PAGE_D / 2 - 0.5 };
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
function shake(dur, amp) { tween(dur, (k) => { shakeK = amp * (1 - k) * (1 - k); }); }
function pickTarget() {
  const p = boss.b.pivot.position;
  for (let i = 0; i < 16; i++) {
    const x = ARENA.x0 + Math.random() * (ARENA.x1 - ARENA.x0), z = ARENA.z0 + Math.random() * (ARENA.z1 - ARENA.z0);
    if (Math.hypot(x - p.x, z - p.z) > 1.2) return new THREE.Vector3(x, 0, z);
  }
  return new THREE.Vector3(-p.x * 0.6, 0, -p.z * 0.6);
}
function toScreen(v) { const p = v.clone().project(camera); return [(p.x + 1) / 2 * innerWidth, (1 - p.y) / 2 * innerHeight]; }
function beastScreen(b) {
  const c = new THREE.Vector3(); b.pivot.getWorldPosition(c); c.y += b.H * 0.4;
  const [x, y] = toScreen(c);
  const r = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(Math.max(b.Wd, b.H * 0.8) * 0.5);
  const [x2, y2] = toScreen(c.clone().add(r));
  return { x, y, r: Math.max(18, Math.hypot(x2 - x, y2 - y)) };
}

// 分部件的狰（头 / 躯干 / 前腿 / 尾 各自独立）：Boss 关里换上它，前腿交替摆、头点、尾甩
let zParts = null;
function loadZParts() {
  fetchModel('zparts', () => {}).then((g) => {
    const root = g.scene; root.updateMatrixWorld(true);
    const get = (n) => { let m = null; root.traverse((o) => { if (o.isMesh && (o.name.includes(n) || (o.parent && o.parent.name.includes(n)))) m = m || o; }); return m; };
    const P = { root };
    const joint = (mesh, f) => { const bb = new THREE.Box3().setFromObject(mesh), c = bb.getCenter(new THREE.Vector3()), s = bb.getSize(new THREE.Vector3()); return f(bb, c, s); };
    const rig = (key, name, f) => {
      const m = get(name); if (!m) return;
      const j = new THREE.Group(); j.position.copy(joint(m, f)); root.add(j); j.updateMatrixWorld(true); j.attach(m); P[key] = j;
    };
    rig('fl', 'front_left_leg', (bb, c, s) => new THREE.Vector3(c.x, bb.max.y - s.y * 0.06, c.z));
    rig('fr', 'front_right_leg', (bb, c, s) => new THREE.Vector3(c.x, bb.max.y - s.y * 0.06, c.z));
    rig('head', 'head', (bb, c, s) => new THREE.Vector3(bb.max.x - s.x * 0.1, bb.min.y + s.y * 0.35, c.z));
    rig('tail', 'tail', (bb, c, s) => new THREE.Vector3(bb.min.x + s.x * 0.05, bb.min.y + s.y * 0.4, c.z));
    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material.envMapIntensity !== undefined) o.material.envMapIntensity = 0.6; } });
    root.visible = false; zParts = P;
  }).catch((e) => console.warn('zparts', e));
}
function zSwap(b, on) {
  if (!zParts) return;
  if (on && zParts.root.parent !== b.fit) b.fit.add(zParts.root);
  zParts.root.visible = on; b.root.visible = !on;
  if (!on) zPose(0, 0, 0, 0, 0);
}
function zPose(fl, fr, head, tailUp, wag) {
  const P = zParts; if (!P) return;
  if (P.fl) P.fl.rotation.z = fl; if (P.fr) P.fr.rotation.z = fr;
  if (P.head) P.head.rotation.z = head;
  if (P.tail) { P.tail.rotation.z = tailUp; P.tail.rotation.y = wag; }
}
async function startBoss(b) {
  if (boss || state !== 'out' || cur !== b) return;
  bossSeen = true; touched = true;
  state = 'boss'; setBusy(true); hideActs(); note.classList.remove('on'); quoteEl.classList.remove('on');
  zSwap(b, true);
  boss = { b, tries: 0, t0: 0, home: b.pivot.position.clone(), yaw0: b.pivot.rotation.y, target: null, speed: 0, run: false, slow: 1, stepT: 0 };
  await flyTo('arena', 1.1);
  // 吼：后仰蓄力 → 冲出
  SFX.thunder(0.5); SFX.stone(0.5); voice(b, 0.22); shake(0.9, 0.09);
  spawnMotes(30, new THREE.Vector3(b.pivot.position.x, PT + 0.05, b.pivot.position.z), { spread: 0.25, vel: [0, 0.5, 0], jitter: 0.8, color: '#c9a77a', life: 0.9, grav: 0.8, drag: 0.5 });
  await tween(0.35, (k) => { b.squash.rotation.x = -0.28 * k; }, { e: ease.out });
  await tween(0.18, (k) => { b.squash.rotation.x = -0.28 * (1 - k); });
  boss.run = true; boss.ph = 'crouch'; boss.pt = 0; boss.pd = 0.2; boss.target = pickTarget(); boss.t0 = nowMs();
  bossTip.textContent = '在它身边画一个圈'; bossTip.classList.remove('bad');
  hud.classList.add('on'); pad.classList.add('on');
  setTimeout(() => { if (boss && boss.run && boss.tries === 0) bossTip.textContent = '画地为牢 · 圈住它'; }, 3500);
}
function updateBoss(dt) {
  if (!boss || !boss.run) return;
  bossTimeEl.textContent = ((nowMs() - boss.t0) / 1000).toFixed(1) + ' 秒';
  // 扑跃节奏：蹲伏张望（转向下一个落点）→ 起跳拉伸 → 抛物线扑出 → 落地压身扬尘
  const B = boss.b, p = B.pivot.position, st = dt * boss.slow;
  if (!boss.ph) { boss.ph = 'crouch'; boss.pt = 0; boss.pd = 0.5; boss.target = pickTarget(); }
  boss.pt += st;
  const k = Math.min(1, boss.pt / boss.pd);
  if (boss.ph === 'crouch') {
    const yaw = Math.atan2(boss.target.x - p.x, boss.target.z - p.z);
    B.pivot.rotation.y += angDiff(yaw, B.pivot.rotation.y) * Math.min(1, st * 6);
    const c = Math.sin(Math.min(1, k * 1.4) * Math.PI / 2); // 越近起跳越低
    B.squash.scale.y = 1 - 0.13 * c; B.squash.rotation.x = 0.1 * c; B.hop = 0;
    const tt = nowMs() / 1000; zPose(0.18 * c, 0.12 * c, 0.16 * c + Math.sin(tt * 3) * 0.04, 0.12, Math.sin(tt * 7) * 0.22);
    if (k >= 1) {
      boss.ph = 'leap'; boss.pt = 0; boss.from = p.clone();
      const d = Math.hypot(boss.target.x - p.x, boss.target.z - p.z);
      boss.pd = 0.38 + d * 0.16; boss.h = 0.22 + d * 0.12;
      SFX.rustle(0.25, 0.12, 2400);
    }
  } else if (boss.ph === 'leap') {
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    p.x = boss.from.x + (boss.target.x - boss.from.x) * e; p.z = boss.from.z + (boss.target.z - boss.from.z) * e;
    B.hop = Math.sin(k * Math.PI) * boss.h;
    B.squash.scale.y = 1 + 0.12 * Math.sin(k * Math.PI);            // 空中拉长
    B.squash.rotation.x = -0.3 * Math.cos(k * Math.PI);             // 起跳抬头、落下俯身
    const sk = Math.sin(k * Math.PI); zPose(-0.75 * sk + 0.35 * k, -0.6 * Math.sin(Math.min(1, k * 1.15) * Math.PI) + 0.35 * k, -0.22 * sk, 0.4 * sk, Math.sin(k * 9) * 0.12);
    if (k >= 1) {
      boss.ph = 'land'; boss.pt = 0; boss.pd = 0.16;
      SFX.thump(0.16); shake(0.18, 0.02);
      spawnMotes(10, new THREE.Vector3(p.x, PT + 0.03, p.z), { spread: 0.18, vel: [0, 0.35, 0], jitter: 0.6, color: '#c9a77a', life: 0.7, grav: 0.6, drag: 0.6 });
    }
  } else if (boss.ph === 'land') {
    B.hop = 0; B.squash.scale.y = 1 - 0.16 * Math.sin(k * Math.PI); B.squash.rotation.x = 0.3 * (1 - k);
    zPose(0.35 * (1 - k), 0.35 * (1 - k), 0.25 * Math.sin(k * Math.PI), 0.1, 0);
    if (k >= 1) {
      boss.target = pickTarget();
      const combo = Math.random() < 0.35; // 偶尔连扑
      boss.ph = 'crouch'; boss.pt = 0; boss.pd = combo ? 0.22 : 0.45 + Math.random() * 0.6;
      if (!combo && Math.random() < 0.3) { SFX.stone(0.16); voice(B, 0.12); }
    }
  }
}
// 画圈
function drawStroke(pts, alpha = 1, bad = false) {
  pctx.clearRect(0, 0, innerWidth, innerHeight);
  if (!pts || pts.length < 2) return;
  pctx.lineCap = 'round'; pctx.lineJoin = 'round';
  const col = bad ? `rgba(255,120,90,${alpha})` : `rgba(240,196,98,${alpha})`;
  pctx.shadowColor = bad ? `rgba(255,90,60,${0.7 * alpha})` : `rgba(255,205,110,${0.85 * alpha})`; pctx.shadowBlur = 16;
  for (let i = 1; i < pts.length; i++) {
    const t = i / pts.length, w = 4 + 6 * Math.sin(Math.min(1, t * 1.1) * Math.PI); // 起笔收笔细，中段粗
    pctx.strokeStyle = col; pctx.lineWidth = w;
    pctx.beginPath(); pctx.moveTo(pts[i - 1][0], pts[i - 1][1]); pctx.lineTo(pts[i][0], pts[i][1]); pctx.stroke();
  }
  pctx.shadowBlur = 0; pctx.strokeStyle = `rgba(255,246,214,${0.8 * alpha})`; pctx.lineWidth = 1.6;
  pctx.beginPath(); pctx.moveTo(pts[0][0], pts[0][1]); pts.forEach((q) => pctx.lineTo(q[0], q[1])); pctx.stroke();
}
function fadeStroke(pts, bad) { return tween(bad ? 0.45 : 0.7, (k) => drawStroke(pts, 1 - k, bad)).then(() => pctx.clearRect(0, 0, innerWidth, innerHeight)); }
pad.addEventListener('pointerdown', (e) => {
  if (!boss || !boss.run) return;
  e.preventDefault(); pad.setPointerCapture(e.pointerId);
  stroke = { pts: [[e.clientX, e.clientY]] }; boss.slow = 0.4; SFX.rustle(0.4, 0.12, 3000);
  placeHand(HANDS.point, e.clientX, e.clientY, Math.min(360, innerWidth * 0.3));
});
pad.addEventListener('pointermove', (e) => {
  if (!stroke) return;
  const l = stroke.pts[stroke.pts.length - 1];
  if (Math.hypot(e.clientX - l[0], e.clientY - l[1]) > 3) { stroke.pts.push([e.clientX, e.clientY]); drawStroke(stroke.pts); }
  placeHand(HANDS.point, e.clientX, e.clientY, Math.min(360, innerWidth * 0.3));
});
pad.addEventListener('pointerup', endStroke); pad.addEventListener('pointercancel', endStroke);
function judge(pts) {
  if (pts.length < 10) return { ok: false, why: '圈要画大一点' };
  const bs = beastScreen(boss.b);
  let P = 0, A = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    P += Math.hypot(x2 - x1, y2 - y1); A += x1 * y2 - x2 * y1;
  }
  A = Math.abs(A) / 2;
  const R = Math.sqrt(A / Math.PI), gap = Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]);
  if (gap > Math.max(70, R * 1.1)) return { ok: false, why: '圈没合上，它溜了' };
  let inside = false; // 射线法
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > bs.y) !== (yj > bs.y) && bs.x < (xj - xi) * (bs.y - yi) / (yj - yi) + xi) inside = !inside;
  }
  if (!inside) return { ok: false, why: '没圈住它' };
  const ratio = R / bs.r;
  if (ratio > 3.6) return { ok: false, why: '圈太大，它从缝里钻走了' };
  const round = Math.min(1, 4 * Math.PI * A / (P * P)), tight = Math.max(0, Math.min(1, (3.6 - ratio) / 2.4));
  return { ok: true, q: round * 0.5 + tight * 0.5, ratio };
}
function endStroke() {
  if (!stroke || !boss) { stroke = null; return; }
  const pts = stroke.pts; stroke = null; boss.slow = 1; HANDS.point.el.style.display = 'none';
  const r = judge(pts);
  if (r.ok) sealIt(r, pts); else failStroke(r.why, pts);
}
function failStroke(why, pts) {
  boss.tries++; fadeStroke(pts, true);
  bossTip.textContent = why; bossTip.classList.add('bad');
  SFX.stone(0.35); voice(boss.b, 0.18); shake(0.4, 0.05);
  if (boss.ph !== 'leap') { boss.target = pickTarget(); boss.ph = 'crouch'; boss.pt = 0; boss.pd = 0.15; }
  clearTimeout(failStroke.t); failStroke.t = setTimeout(() => { if (boss && boss.run) { bossTip.textContent = '画地为牢 · 圈住它'; bossTip.classList.remove('bad'); } }, 1500);
}
async function sealIt(res, pts) {
  const b = boss.b; boss.run = false; boss.tries++; pad.classList.remove('on');
  const secs = (nowMs() - boss.t0) / 1000, tries = boss.tries;
  bossTip.textContent = '封！'; bossTip.classList.remove('bad'); bossTimeEl.textContent = secs.toFixed(1) + ' 秒';
  b.hop = 0; b.squash.rotation.x = 0; b.squash.scale.y = 1;
  const p = b.pivot.position.clone(), yaw = b.pivot.rotation.y;
  const R = Math.max(0.5, Math.min(0.85, Math.max(b.Wd, b.H * 0.7) * 0.6)), H = b.H * 1.05; // 笼按狰的体型定大小
  const grp = new THREE.Group(); grp.position.set(p.x, PT + 0.004, p.z); vol.group.add(grp);
  // 手画的圈落成书页上的金墨圈
  const ring = brushRing(R); grp.add(ring.mesh);
  SFX.rustle(0.5, 0.3);
  await Promise.all([fadeStroke(pts, false), tween(0.45, (k) => ring.draw(k), { e: ease.out })]);
  spawnMotes(30, new THREE.Vector3(p.x, PT + 0.05, p.z), { spread: R * 0.9, vel: [0, 0.4, 0], jitter: 0.3, color: '#f0c462', life: 1.1, grav: -0.1, drag: 0.5 });
  // 金笼折起：圈越准越快
  const sp = 1.25 - 0.65 * res.q;
  const F = cageTexture('front'), Bk = SCENE_IMG.cage_back ? cageTexture('back') : F;
  const cw = Math.max(R * 2.05, H / F.aspect);
  const mkCard = (dark) => {
    const T = dark ? Bk : F, hh = cw * T.aspect, geo = new THREE.PlaneGeometry(cw, hh); geo.translate(0, hh / 2, 0);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: T.tex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.35, envMapIntensity: 1.1, color: dark ? (Bk === F ? 0x7a6040 : 0xc9b48c) : 0xffffff }));
    m.castShadow = true; m.rotation.x = dark ? -Math.PI / 2 : Math.PI / 2; return m;
  };
  const back = mkCard(true), front = mkCard(false);
  back.position.set(0, 0.002, -R * 0.62); back.scale.setScalar(0.94); front.position.set(0, 0.004, R * 0.62);
  grp.add(back, front);
  await tween(0.55 * sp, (k) => { back.rotation.x = -Math.PI / 2 * (1 - k); }, { e: ease.back });
  SFX.pluck(392, 0.2);
  await tween(0.55 * sp, (k) => { front.rotation.x = Math.PI / 2 * (1 - k); }, { e: ease.back });
  SFX.bells(0.24); shake(0.3, 0.03);
  spawnMotes(40, new THREE.Vector3(p.x, PT + H * 0.8, p.z + R * 0.62), { spread: cw * 0.4, vel: [0, 0.25, 0], jitter: 0.5, color: '#ffd36e', life: 1.4, grav: -0.2, drag: 0.4 });
  // 笼中挣扎
  SFX.stone(0.3); voice(b, 0.2);
  await tween(1.0, (k) => { b.squash.rotation.z = Math.sin(k * 42) * 0.07 * (1 - k); b.hop = Math.abs(Math.sin(k * 30)) * 0.05 * (1 - k); zPose(Math.sin(k * 50) * 0.6 * (1 - k), Math.sin(k * 50 + 2) * 0.6 * (1 - k), Math.sin(k * 36) * 0.3 * (1 - k), 0.3 * (1 - k), Math.sin(k * 60) * 0.5 * (1 - k)); });
  zPose(0, 0, 0.12, 0, 0);
  // 朱印落下
  const seal = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.46), new THREE.MeshStandardMaterial({ map: sealTex('画地为牢'), transparent: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -3 }));
  seal.rotation.set(-Math.PI / 2, 0, 0.08);
  const sx = Math.max(-PAGE_W + 0.35, Math.min(PAGE_W - 0.35, p.x + R + 0.3)), sz = Math.max(-PAGE_D / 2 + 0.35, Math.min(PAGE_D / 2 - 0.35, p.z + R * 0.4));
  vol.group.add(seal); seal.position.set(sx, PT + 0.6, sz); seal.scale.setScalar(1.6);
  await tween(0.32, (k) => { seal.position.y = PT + 0.006 + 0.6 * (1 - k) * (1 - k); seal.scale.setScalar(1.6 - 0.6 * k); }, { e: (t) => t });
  SFX.thump(0.5); shake(0.35, 0.05);
  spawnMotes(24, new THREE.Vector3(sx, PT + 0.02, sz), { spread: 0.2, vel: [0, 0.3, 0], jitter: 0.6, color: '#b23a2a', life: 0.6, grav: 1.5, drag: 0.5 });
  bossTip.textContent = '已收服';
  await sleep(0.9);
  // 笼收、圈淡，狰回到图版上
  hud.classList.remove('on');
  await Promise.all([
    tween(0.6, (k) => { front.scale.y = Math.max(0.001, 1 - k); back.scale.y = Math.max(0.001, 0.94 * (1 - k)); }, { e: ease.io }),
    tween(1.0, (k) => { ring.mat.opacity = 1 - k; }),
    tween(1.0, (k) => { b.pivot.position.lerpVectors(p, boss.home, k); b.pivot.rotation.y = yaw + angDiff(boss.yaw0, yaw) * k; }, { e: ease.io, delay: 0.2 }),
  ]);
  vol.group.remove(grp); ring.mat.map.dispose(); F.tex.dispose(); if (Bk !== F) Bk.tex.dispose();
  tween(1.2, (k) => { seal.material.opacity = 1 - k; }, { delay: 1.5 }).then(() => vol.group.remove(seal));
  zSwap(b, false);
  boss = null; state = 'out';
  await guice(); // 收回书页
  const rank = tries === 1 ? '一笔成牢' : tries <= 3 ? `${['', '一', '二', '三'][tries]}笔成牢` : '终得收服';
  $('bossStat').textContent = `${rank} · 用时 ${secs.toFixed(1)} 秒`;
  bossRes.classList.add('on'); SFX.pluck(523.25, 0.2);
}
function endBoss() { // 跳过：狰自己走回图版
  if (!boss) return;
  const b = boss.b, p = b.pivot.position.clone(), yaw = b.pivot.rotation.y, home = boss.home, y0 = boss.yaw0;
  boss.run = false; stroke = null; pctx.clearRect(0, 0, innerWidth, innerHeight);
  pad.classList.remove('on'); hud.classList.remove('on'); b.hop = 0; b.squash.rotation.x = 0; b.squash.scale.y = 1;
  tween(0.9, (k) => { b.pivot.position.lerpVectors(p, home, k); b.pivot.rotation.y = yaw + angDiff(y0, yaw) * k; }, { e: ease.io }).then(() => {
    zSwap(b, false); boss = null; state = 'out'; setBusy(false); flyTo('beast', 1.2); showActs(b); note.classList.add('on');
  });
}
$('bossSkip').onclick = endBoss;
// 收服后狰已入册：留在书页上，不再出册；「翻下一页」看下一只兽
$('bossOk').onclick = () => {
  bossRes.classList.remove('on');
  if (state === 'idle' && vol && curIdx < vol.beasts.length - 1) turn(1);
  else { hint.textContent = '狰已入册'; hint.style.opacity = 1; }
};
$('bossAgain').onclick = () => { bossRes.classList.remove('on'); bossSeen = false; chuce(); };
ACTS.seal = async (b) => { await startBoss(b); };


// 神笔马良示例：蜡笔原画 → Lux3D 立体（预先生成）→ 装订成新书 → 出册
const MM_SAMPLES = [
  { model: 'mm1', origin: '蜡笔原画', img: 'assets/mm1.jpg', name: '紫象', title: '神笔马良', label: '紫象', sub: '蜡笔画 → 立体', desc: '一支蜡笔，随手画了一只紫色的大象。马良的笔一点，它便从纸上走了出来。' },
  { model: 'mm2', origin: '水彩插画', img: 'assets/mm2.jpg', name: '笑猫', title: '笑猫日记', label: '笑猫日记', sub: '水彩画 → 立体', desc: '戴着水手帽、叼着一朵玫瑰的笑猫，从插画里踮着脚走了出来。' },
];
let mmBusy = false;
async function runMM(m) {
  studioModal.classList.remove('on');
  if (mmBusy || making) return;            // 连点只算一次
  mmBusy = true;
  try {
    if (!(await toDesk())) return;
    if (m.vol && VOLUMES.includes(m.vol)) { selIdx = VOLUMES.indexOf(m.vol); deskUI(); return openBook(); }
    hint.textContent = '神笔落墨……'; hint.style.opacity = 1;
    const g = await fetchModel(m.model, () => {});
    m.vol = await makeUserBook(g, { name: m.name, title: m.title, desc: m.desc, scene0: 'none', sketch: m.img, origin: m.origin });
  } finally { mmBusy = false; }
}
MM_SAMPLES.forEach((m) => {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'card';
  b.innerHTML = `<img alt="" src="${m.img}"><b>${m.label}</b><small>${m.sub}</small>`;
  b.onclick = () => runMM(m); $('mmSamples').insertBefore(b, $('genBook'));
});
const sketchEl = $('sketch');
function updateSketch() {
  const on = (state === 'out' || state === 'boss') && cur && cur.sketch;
  if (on && sketchEl.dataset.src !== cur.sketch) { $('sketchImg').src = cur.sketch; sketchEl.dataset.src = cur.sketch; }
  sketchEl.classList.toggle('on', !!on);
}

/* ------------------------------------------------------------------ 循环 */
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  if (state === 'closed') VOLUMES.forEach((v) => v.group && placeOnDesk(v));
  if (cur && (state === 'idle' || state === 'out' || state === 'closed')) { // 转屏/改窗口后重新取景
    const s = SHOTS[lastShot](); camera.position.copy(s.pos); controls.target.copy(s.tgt); view.offX = s.offX; view.offY = s.offY; applyOffset();
  }
}
window.addEventListener('resize', resize); resize();

const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const now = nowMs();
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i]; if (now < tw.t0) continue;
    const k = Math.min(1, (now - tw.t0) / tw.dur); tw.fn(tw.e(k));
    if (k >= 1) { tweens.splice(i, 1); tw.res(); }
  }
  const dt = Math.min(0.05, clock.getDelta()); const t = clock.elapsedTime;
  plateUniforms.uTime.value = t;
  updateMotes(dt); updateRain(dt); updateDeskFigs(t, dt); updateHearts(dt); updateGuests(t, dt); updateTapHint(); tapeEl.classList.toggle('off', state !== 'closed'); updateDesk(dt); updateStudy(dt); updateBoss(dt); updateHands(dt); updateSketch(); updateDust(dt); SFX.setBgm(bgmTrack(), state === 'boss' ? 0.3 : 0.32);
  if (cur && cur.wind) cur.wind.uWT.value = t;
  if (cur && cur.props && props && state === 'out') placeProps(cur, 1);
  if (cur) for (const b of figs(cur)) {
    b.u.uTime.value = t;
    updateHead(b, dt); if (state === 'out') updateEar(b, t); else b.u.uEar.value = 0;
    const breathe = state === 'out' && !b.hover ? Math.sin(t * 1.6) * 0.004 * Math.min(1, b.H / 1.4) : 0;
    const sm = b.size || 1;
    b.fit.scale.setScalar(b.k * sm); b.fit.position.x = b.fitBase.x * sm; b.fit.position.z = b.fitBase.z * sm;
    b.fit.position.y = b.restY * sm + (b.hop || 0) + breathe;
    if (b.hover) b.pivot.position.y = PT + 0.004 + (b.lift || 0) * (b.hover + Math.sin(t * (b.drift ? 0.7 : 1.3)) * (b.drift ? 0.06 : 0.035));
    if (b.drift && state === 'out') { b.squash.rotation.y = 0.38 * Math.sin(t * 0.3) * (b.lift || 0); b.squash.rotation.z = 0.07 * Math.sin(t * 0.5) * (b.lift || 0); }
  }
  for (const v of VOLUMES) { // 接触阴影：翻动的那半随翻开程度出现；进兔子洞时一起淡去
    if (!v.group) continue;
    const open = 1 - v.hinge.rotation.z / v.closedAngle, fade = v === vol ? 1 - holeK : 1;
    (v.binding === 'right' ? v.aoR : v.aoL).material.opacity = 0.75 * open * open * fade;
    (v.binding === 'right' ? v.aoL : v.aoR).material.opacity = 0.75 * fade;
  }
  if (vol && holeK > 0) { vol.group.position.y = Math.sin(t * 0.6) * 0.06 * holeK; vol.group.rotation.z = Math.sin(t * 0.45) * 0.02 * holeK; }
  else if (vol && state !== 'opening' && state !== 'closing') { vol.group.position.y = 0; vol.group.rotation.z = 0; }
  if (controls.enabled) controls.update();
  else camera.lookAt(controls.target);
  if (shakeK > 0.0005) { const o = camera.position.clone(); camera.position.x += (Math.random() - 0.5) * shakeK; camera.position.y += (Math.random() - 0.5) * shakeK; renderer.render(scene, camera); camera.position.copy(o); }
  else renderer.render(scene, camera);
}

/* ------------------------------------------------------------------ 启动 */
// 模型以 base64 JSON 托管（部分托管平台不接受 .glb）
async function fetchModel(name, onBytes) {
  const res = await fetch(`./assets/${name}.json`);
  const reader = res.body.getReader(); const chunks = [];
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); onBytes(value.length); }
  const text = new TextDecoder().decode(await new Blob(chunks).arrayBuffer());
  const bin = Uint8Array.from(atob(JSON.parse(text).data), (c) => c.charCodeAt(0));
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  return new Promise((ok, bad) => loader.parse(bin.buffer, './assets/', ok, bad));
}
const loadImg = (src) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });

async function boot() {
  const lbar = $('lbar');
  const TOTAL = 13.7e6; let got = 0;
  const onBytes = (n) => { got += n; lbar.style.width = Math.min(98, got / TOTAL * 100).toFixed(0) + '%'; };
  const fontsReady = Promise.race([
    Promise.all([document.fonts.load(`46px "Noto Serif SC"`), document.fonts.load(`46px "Ma Shan Zheng"`), document.fonts.load(`900 46px "Noto Serif SC"`),
      document.fonts.load(`34px "EB Garamond"`), document.fonts.load(`italic 52px "EB Garamond"`), document.fonts.load(`600 64px "EB Garamond"`)]).catch(() => {}),
    sleep(3),
  ]);
  const PAGES = VOLUMES.flatMap((v) => v.beasts), ALL = PAGES.flatMap(figs);
  ALL.forEach(makeRig);
  const plates = Promise.all(PAGES.map((b) => loadImg('./assets/' + b.plate).then((im) => (b.plateImg = im))));
  const models = Promise.all(ALL.map((b) => fetchModel(b.model, onBytes)));
  const looks = Promise.all(['desk.jpg', 'cover.jpg', 'cloth.jpg', 'rabbit.jpg'].map((f) => loadImg('./assets/' + f)));
  const sceneImgs = Promise.all(['qq_far', 'qq_mid', 'qq_front', 'zg_far', 'zg_mid', 'zg_front', 'yl_far', 'yl_mid', 'yl_front', 'xw_sky', 'xw_wheat', 'xw_bank', 'cage_front', 'cage_back'].map((n) => loadImg(`./assets/${n}.webp`).then((im) => (SCENE_IMG[n] = im)).catch(() => {})));
  loadImg('./assets/qq_world.jpg').catch(() => {}); // 预载“世界铺开”大图
  const [, , gltfs, [deskImg, coverImg, clothImg]] = await Promise.all([fontsReady, plates, models, looks, sceneImgs]);
  setDeskImage(deskImg); looksCache = { cloth: clothImg };
  PAGES.forEach((b, i) => prepPages(b, i));
  buildVolume(VOLUMES[0], { cover: coverImg, cloth: clothImg });
  buildVolume(VOLUMES[1], { cover: aliceCoverCanvas(clothImg), cloth: tintCanvas(clothImg, '#7d2622', '#c9605a') });
  buildVolume(VOLUMES[2], { cover: princeCoverCanvas(clothImg), cloth: tintCanvas(clothImg, '#1e2a52', '#7d8fc0') });
  ALL.forEach((b, i) => mountBeast(b, gltfs[i]));
  vol = VOLUMES[0]; cur = vol.beasts[0]; // 供取景、预编译使用；书案状态下不显示内页信息

  const s = SHOTS.closed(); camera.position.copy(s.pos); controls.target.copy(s.tgt); view.offX = s.offX; view.offY = s.offY; applyOffset(); camera.lookAt(s.tgt);
  // 预编译所有角色的着色器，避免第一次出册时卡顿
  ALL.forEach((b) => (b.pivot.visible = true)); renderer.compile(scene, camera); ALL.forEach((b) => (b.pivot.visible = false));
  vol = null;
  requestAnimationFrame(frame);
  $('loader').classList.add('go'); studyEl.classList.add('in'); // 镜头推进书房，桌子与书淡入
  setTimeout(() => { $('loader').style.opacity = 0; }, 350); setTimeout(() => $('loader').remove(), 1800);
  state = 'closed'; deskUI(); setBusy(false); goBtn.disabled = false;
  goBtn.textContent = '翻开';
  setTimeout(loadZParts, 1500);
  autoOpen = setTimeout(openBook, 12000); // 无人操作时自动翻开第一本
  LUX3D.init();
  window.__chuce = { cc: () => vol && coverCorner(vol), sc: () => sheetCorner(), get zp() { return zParts && Object.keys(zParts); }, get boss() { return boss && { run: boss.run, tries: boss.tries, s: beastScreen(boss.b) }; }, setInk: (c) => { inkColor = c; }, pickInfo: (x, y) => { ndc.set(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera); return VOLUMES.map((v) => [v.id, ray.intersectObject(v.group, true).slice(0, 4).map((h) => { let vis = true; for (let o = h.object; o; o = o.parent) if (!o.visible) vis = false; return [h.object.name || h.object.type, h.object.parent && h.object.parent.type, +h.distance.toFixed(2), vis]; })]); }, deskFigs, get guests() { return guests; }, screenOf: (o) => { const v = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()).project(camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; }, stopAuto: () => clearTimeout(autoOpen), setSlow: (v) => (SLOW = v), vt: (ms) => (VT = ms), get vtime() { return nowMs(); }, chuce, guice, turn, openBook, closeBook, navigate,
    get state() { return state; }, get cur() { return cur; }, set sel(i) { selIdx = i; }, camera, controls, VOLUMES, plateUniforms, sheet, SHOTS, setHole, get rainK() { return rainK; }, get lampI() { return lamp.intensity; }, get motes() { return moteList.length; } };
}
boot().catch((e) => { console.error(e); $('ltext').textContent = '载入失败，请刷新'; });

/* 组装对比网格：列 = 棋子，行 = 技术路线 */
(function () {
  const UNITS = [
    { id: 'duanyue', name: '断岳', title: '墨刀卫' },
    { id: 'pan', name: '磐', title: '石灵' },
    { id: 'zhuyan', name: '朱炎', title: '毕方' },
    { id: 'jingyu', name: '惊羽', title: '弓手' },
  ];

  const ROWS = [
    {
      key: 'svg', name: 'A · SVG 手绘矢量', en: 'Hand-drawn Vector',
      desc: '分层贝塞尔路径 + 墨边滤镜，改色换装零成本，任意放大不糊。接入：启动时光栅化烘焙成纹理，管线与现版剪影一致。',
      verdict: '观感上限最高、最贴案头气质；吃画功，64 棋子要逐个手绘。',
      mount(td, u) { td.innerHTML = window.SVG_UNITS[u.id].render(); },
    },
    {
      key: 'voxel', name: 'B · 体素等距', en: 'Voxel (pre-render)',
      desc: '逐体素三面着色 + 隐藏面剔除，模型用盒子 DSL 描述，可离线批量烘焙 PNG 精灵图，运行期零开销。',
      verdict: '体量感、玩具感最强，风格辨识度高；曲线与披帛类造型吃力。',
      mount(td, u) {
        const c = mkCanvas(td);
        window.VOXEL_UNITS.draw(c, window.VOXEL_UNITS[u.id].render());
      },
    },
    {
      key: 'pixel', name: 'C · 像素画', en: 'Pixel Art',
      desc: '字符串位图手排 + 字符调色板，整数倍最近邻放大。烘焙 PNG 后与普通贴图无异。',
      verdict: '复古亲和、性能最省、帧动画手感好；与水墨案头气质有距离。',
      mount(td, u) {
        const c = mkCanvas(td);
        window.PIXEL_UNITS.draw(c, window.PIXEL_UNITS[u.id].sprite);
      },
    },
    {
      key: 'poly', name: 'D · 低模 3D', en: 'Low-poly 3D (live)',
      desc: '锥台盒脚本建模 + 平面着色，本格为零依赖软件渲染、实时自转。接入可烘焙序列帧，或在棋盘上加薄 3D 层。',
      verdict: '唯一“能转起来”的方案，镜头与演出空间最大；建模脚本量最大。',
      mount(td, u) {
        const c = mkCanvas(td);
        window.POLY_UNITS.mount(c, window.POLY_UNITS[u.id].build);
      },
    },
  ];

  function mkCanvas(td, w = 210, h = 236) {
    const c = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    c.width = w * dpr; c.height = h * dpr;
    c.style.width = w + 'px'; c.style.height = h + 'px';
    td.appendChild(c);
    return c;
  }

  const head = document.getElementById('head');
  head.appendChild(document.createElement('th'));
  for (const u of UNITS) {
    const th = document.createElement('th');
    th.innerHTML = `${u.name}<span class="en">${u.title}</span>`;
    head.appendChild(th);
  }

  const grid = document.getElementById('grid');
  function showErr(msg) {
    const d = document.createElement('div');
    d.style.cssText = 'color:#ff8878;font-size:13px;margin-top:8px;font-family:Consolas,monospace';
    d.textContent = '装配错误: ' + msg;
    document.getElementById('notes').appendChild(d);
  }
  for (const row of ROWS) {
    const tr = document.createElement('tr');
    const rh = document.createElement('td');
    rh.className = 'rowhead';
    rh.innerHTML = `<div class="name">${row.name}</div><div class="desc">${row.desc}</div><div class="verdict">${row.verdict}</div>`;
    tr.appendChild(rh);
    for (const u of UNITS) {
      const td = document.createElement('td');
      td.className = 'cell';
      tr.appendChild(td);
      try {
        row.mount(td, u);
      } catch (err) {
        showErr(row.name + ' / ' + u.name + ' → ' + err.message + '\n' + (err.stack || '').split('\n')[1]);
      }
    }
    grid.appendChild(tr);
  }

  document.getElementById('notes').innerHTML =
    '接入成本对照 —— <b>SVG</b>：新增 <code>svg → canvas → 烘焙</code> 一步，血条白闪/染色全部保留；' +
    '<b>体素/像素</b>：node 脚本离线出 PNG 图集，运行期与现版完全一致；' +
    '<b>低模 3D</b>：序列帧（体积大）或实时渲染（需自研薄渲染层）。' +
    '四路线都保留“剪影可辨 + 阵营边缘光 + 稀有度底座”的信息设计。';

  window.POLY_UNITS.start();
})();

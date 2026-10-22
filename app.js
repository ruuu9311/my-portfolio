import { initializeApp } from
  "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";

import {
  getAuth,
  GithubAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCAP-YwWjL-4ALRP8JktQj0nkGMQhTu5t4",
  authDomain: "portfolio-4db38.firebaseapp.com",
  projectId: "portfolio-4db38",
  storageBucket: "portfolio-4db38.firebasestorage.app",
  messagingSenderId: "364487390288",
  appId: "1:364487390288:web:ae2587a56577af32550d55"
};

const OWNER_UID = "gShe048rcqPAQYEyRaklHHsE2sJ3";

const MAX_DOC_BYTES = 900000;
const CROP_BOX = 240;
const THUMB_SIZE = 480;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const portfolioRef = doc(db, "public", "portfolio");

const $ = (id) => document.getElementById(id);
const status = (text) => { $("status").textContent = text; };

let repositories = [];
let selectedIds = new Set();
let githubProjects = [];
let externalProjects = [];
let workOrder = [];

let editingId = null;
let editingThumb = "";

let cropImg = null;
let cropBase = 1;
let cropScale = 1;
let cropX = 0;
let cropY = 0;
let cropDirty = false;

function showError(error) {
  console.error(error);
  status(`操作失敗：${error.code || ""}\n${error.message}`);
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function safeThumb(value) {
  return typeof value === "string" && value.startsWith("data:image/")
    ? value
    : "";
}

function assertOwner() {
  if (!OWNER_UID || auth.currentUser?.uid !== OWNER_UID) {
    throw new Error("沒有編輯權限，請先用管理員帳號登入。");
  }
}

async function persist(fields) {
  assertOwner();

  const preview = {
    projects: fields.projects ?? githubProjects,
    externalProjects: fields.externalProjects ?? externalProjects
  };

  const size = new Blob([JSON.stringify(preview)]).size;
  if (size > MAX_DOC_BYTES) {
    throw new Error(
      "作品資料太大（接近 Firestore 單一文件 1 MiB 上限）。" +
      "請移除部分縮圖，或改用較小的圖片。"
    );
  }

  await setDoc(
    portfolioRef,
    { ...fields, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

function allWorks() {
  const works = [
    ...externalProjects.map((item) => ({ item, kind: "external" })),
    ...githubProjects.map((item) => ({ item, kind: "github" }))
  ];

  const rank = new Map(workOrder.map((id, index) => [String(id), index]));

  return works
    .map((work, index) => ({ ...work, index }))
    .sort((a, b) => {
      const rankA = rank.has(String(a.item.id))
        ? rank.get(String(a.item.id))
        : 1000000 + a.index;
      const rankB = rank.has(String(b.item.id))
        ? rank.get(String(b.item.id))
        : 1000000 + b.index;
      return rankA - rankB;
    });
}

async function moveWork(id, direction) {
  const ids = allWorks().map(({ item }) => String(item.id));
  const from = ids.indexOf(String(id));
  const to = from + direction;

  if (from < 0 || to < 0 || to >= ids.length) return;

  [ids[from], ids[to]] = [ids[to], ids[from]];

  try {
    await persist({ workOrder: ids });
    workOrder = ids;
    renderAll();
  } catch (error) {
    showError(error);
  }
}

function addLink(parent, label, value) {
  const href = safeUrl(value);
  if (!href) return;

  const link = document.createElement("a");
  link.textContent = label;
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  parent.append(link);
}

function renderProjects(projects) {
  $("projects").replaceChildren();

  if (!projects.length) {
    $("projects").textContent = "目前尚未發布作品。";
    return;
  }

  for (const project of projects) {
    const card = document.createElement("article");
    card.className = "card";

    const thumb = safeThumb(project.thumbnail);
    if (thumb) {
      const image = document.createElement("img");
      image.className = "thumb";
      image.src = thumb;
      image.alt = `${project.name} 縮圖`;
      image.loading = "lazy";
      card.append(image);
    }

    const title = document.createElement("h3");
    title.textContent = project.name;

    const description = document.createElement("p");
    description.textContent = project.description || "尚未填寫作品介紹";

    const label = document.createElement("p");
    label.className = "muted";
    label.textContent = project.language || "其他";

    const links = document.createElement("div");
    links.className = "links";
    addLink(links, "查看 GitHub", project.githubUrl);
    addLink(links, "瀏覽網站", project.demoUrl);
    addLink(links, "查看簡報", project.slidesUrl);

    card.append(title, description, label);
    if (links.children.length) card.append(links);

    $("projects").append(card);
  }
}

function makeButton(text, className, handler, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  if (label) button.setAttribute("aria-label", label);
  button.addEventListener("click", handler);
  return button;
}

function renderWorkList() {
  const list = $("workList");
  list.replaceChildren();

  const works = allWorks();
  if (!works.length) {
    list.textContent = "目前還沒有作品。";
    return;
  }

  works.forEach(({ item, kind }, position) => {
    const row = document.createElement("div");
    row.className = "work-item";

    const order = document.createElement("div");
    order.className = "order-buttons";

    const up = makeButton("▲", "small icon secondary",
      () => moveWork(item.id, -1), "上移");
    up.disabled = position === 0;

    const down = makeButton("▼", "small icon secondary",
      () => moveWork(item.id, 1), "下移");
    down.disabled = position === works.length - 1;

    order.append(up, down);
    row.append(order);

    const thumb = safeThumb(item.thumbnail);
    if (thumb) {
      const image = document.createElement("img");
      image.className = "mini";
      image.src = thumb;
      image.alt = "";
      row.append(image);
    } else {
      const empty = document.createElement("div");
      empty.className = "mini";
      row.append(empty);
    }

    const info = document.createElement("div");
    info.className = "work-info";

    const name = document.createElement("strong");
    name.textContent = item.name;

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = kind === "github" ? "GitHub" : "網站";
    name.append(badge);

    if (item.slidesUrl) {
      const slides = document.createElement("span");
      slides.className = "badge";
      slides.textContent = "簡報";
      name.append(slides);
    }

    const url = document.createElement("p");
    url.className = "muted";
    url.textContent = item.demoUrl || item.githubUrl || "尚無連結";

    info.append(name, url);

    const buttons = document.createElement("div");
    buttons.className = "work-buttons";
    buttons.append(makeButton("編輯", "small", () => openEditor(item.id)));

    if (kind === "external") {
      buttons.append(
        makeButton("刪除", "small danger", () => removeExternal(item.id))
      );
    }

    row.append(info, buttons);
    list.append(row);
  });
}

function renderAll() {
  renderProjects(allWorks().map(({ item }) => item));
  renderWorkList();
}

async function loadPortfolio() {
  const snapshot = await getDoc(portfolioRef);
  const data = snapshot.exists() ? snapshot.data() : {};

  githubProjects = data.projects || [];
  externalProjects = data.externalProjects || [];
  workOrder = (data.workOrder || []).map(String);
  selectedIds = new Set(githubProjects.map((project) => project.id));

  renderAll();
}

async function removeExternal(id) {
  const target = externalProjects.find((item) => item.id === id);
  if (!target || !confirm(`確定要刪除「${target.name}」嗎？`)) return;

  try {
    const next = externalProjects.filter((item) => item.id !== id);
    await persist({ externalProjects: next });
    externalProjects = next;
    renderAll();
    status("已刪除網站作品。");
  } catch (error) {
    showError(error);
  }
}

/* ---------- 縮圖 1:1 調整 ---------- */

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("無法讀取這張圖片。"));
    image.src = src;
  });
}

function clampCrop() {
  const width = cropImg.naturalWidth * cropScale;
  const height = cropImg.naturalHeight * cropScale;
  cropX = Math.min(0, Math.max(CROP_BOX - width, cropX));
  cropY = Math.min(0, Math.max(CROP_BOX - height, cropY));
}

function drawCrop() {
  const context = $("cropCanvas").getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, CROP_BOX, CROP_BOX);
  context.drawImage(
    cropImg,
    cropX,
    cropY,
    cropImg.naturalWidth * cropScale,
    cropImg.naturalHeight * cropScale
  );
}

function setupCrop(image, dirty) {
  cropImg = image;
  cropBase = Math.max(
    CROP_BOX / image.naturalWidth,
    CROP_BOX / image.naturalHeight
  );
  cropScale = cropBase;
  cropX = (CROP_BOX - image.naturalWidth * cropScale) / 2;
  cropY = (CROP_BOX - image.naturalHeight * cropScale) / 2;
  cropDirty = dirty;

  $("cropZoom").value = "1";
  $("cropBox").hidden = false;
  drawCrop();
}

function closeCrop() {
  cropImg = null;
  cropDirty = false;
  $("cropBox").hidden = true;
}

function renderCrop() {
  const canvas = document.createElement("canvas");
  canvas.width = THUMB_SIZE;
  canvas.height = THUMB_SIZE;

  const ratio = THUMB_SIZE / CROP_BOX;
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, THUMB_SIZE, THUMB_SIZE);
  context.drawImage(
    cropImg,
    cropX * ratio,
    cropY * ratio,
    cropImg.naturalWidth * cropScale * ratio,
    cropImg.naturalHeight * cropScale * ratio
  );

  return canvas.toDataURL("image/jpeg", 0.78);
}

(function bindCropEvents() {
  const canvas = $("cropCanvas");
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener("pointerdown", (event) => {
    if (!cropImg) return;
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!dragging || !cropImg) return;

    const factor = CROP_BOX / canvas.getBoundingClientRect().width;
    cropX += (event.clientX - lastX) * factor;
    cropY += (event.clientY - lastY) * factor;
    lastX = event.clientX;
    lastY = event.clientY;

    clampCrop();
    drawCrop();
    cropDirty = true;
  });

  const stop = () => { dragging = false; };
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointercancel", stop);

  $("cropZoom").addEventListener("input", () => {
    if (!cropImg) return;

    const centerX = (CROP_BOX / 2 - cropX) / cropScale;
    const centerY = (CROP_BOX / 2 - cropY) / cropScale;

    cropScale = cropBase * Number($("cropZoom").value);
    cropX = CROP_BOX / 2 - centerX * cropScale;
    cropY = CROP_BOX / 2 - centerY * cropScale;

    clampCrop();
    drawCrop();
    cropDirty = true;
  });
})();

function openEditor(id) {
  const found = allWorks().find(({ item }) => item.id === id);
  if (!found) return;

  const { item, kind } = found;
  editingId = id;
  editingThumb = safeThumb(item.thumbnail);

  $("editTitle").textContent =
    `編輯作品（${kind === "github" ? "GitHub" : "網站"}）`;
  $("editName").value = item.name || "";
  $("editDescription").value = item.description || "";
  $("editLabel").value = item.language || "";
  $("editUrl").value = item.demoUrl || "";
  $("editSlides").value = item.slidesUrl || "";
  $("editFile").value = "";

  closeCrop();
  if (editingThumb) {
    loadImage(editingThumb)
      .then((image) => {
        if (editingId === id) setupCrop(image, false);
      })
      .catch(() => {});
  }

  $("editDialog").showModal();
}

$("editFile").addEventListener("change", async () => {
  const file = $("editFile").files[0];
  if (!file) return;

  try {
    if (!file.type.startsWith("image/")) {
      throw new Error("請選擇圖片檔案。");
    }

    const url = URL.createObjectURL(file);
    try {
      const image = await loadImage(url);
      setupCrop(image, true);
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (error) {
    $("editFile").value = "";
    showError(error);
  }
});

$("removeThumb").addEventListener("click", () => {
  editingThumb = "";
  $("editFile").value = "";
  closeCrop();
});

$("cancelEdit").addEventListener("click", () => {
  $("editDialog").close();
});

$("editForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("saveEdit").disabled = true;

  try {
    const name = $("editName").value.trim();
    const urlText = $("editUrl").value.trim();
    const slidesText = $("editSlides").value.trim();
    const demoUrl = urlText ? safeUrl(urlText) : "";
    const slidesUrl = slidesText ? safeUrl(slidesText) : "";

    if (!name) throw new Error("請輸入作品名稱。");
    if (urlText && !demoUrl) {
      throw new Error("網頁連結格式不正確，需以 https:// 開頭。");
    }
    if (slidesText && !slidesUrl) {
      throw new Error("簡報連結格式不正確，需以 https:// 開頭。");
    }

    // 只有重新選圖、拖曳或縮放過，才重新輸出縮圖。
    if (cropImg && cropDirty) {
      editingThumb = renderCrop();
    }

    const changes = {
      name,
      description: $("editDescription").value.trim(),
      language: $("editLabel").value.trim(),
      demoUrl,
      slidesUrl,
      thumbnail: editingThumb,
      edited: true
    };

    const isExternal = externalProjects.some((item) => item.id === editingId);

    if (isExternal) {
      const next = externalProjects.map((item) =>
        item.id === editingId ? { ...item, ...changes } : item
      );
      await persist({ externalProjects: next });
      externalProjects = next;
    } else {
      const next = githubProjects.map((item) =>
        item.id === editingId ? { ...item, ...changes } : item
      );
      await persist({ projects: next });
      githubProjects = next;
    }

    renderAll();
    $("editDialog").close();
    closeCrop();
    status(`已儲存：${name}`);
  } catch (error) {
    showError(error);
  } finally {
    $("saveEdit").disabled = false;
  }
});

/* ---------- GitHub 同步與發布 ---------- */

function renderRepositories() {
  $("repos").replaceChildren();

  if (!repositories.length) {
    $("repos").textContent = "沒有找到你的公開 Repository。";
  }

  for (const repo of repositories) {
    const row = document.createElement("label");
    row.className = "repo";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedIds.has(repo.id);

    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedIds.add(repo.id);
      else selectedIds.delete(repo.id);
    });

    const content = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = repo.name;

    const description = document.createElement("p");
    description.className = "muted";
    description.textContent = repo.description || "沒有描述";

    content.append(title, description);
    row.append(checkbox, content);
    $("repos").append(row);
  }

  $("publish").disabled = false;
}

async function fetchRepositories(token) {
  const all = [];

  for (let page = 1; ; page++) {
    const url =
      "https://api.github.com/user/repos" +
      `?visibility=public&affiliation=owner&per_page=100` +
      `&sort=updated&page=${page}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json"
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub API 回應 ${response.status}`);
    }

    const batch = await response.json();
    all.push(...batch);

    if (batch.length < 100) break;
  }

  return all.filter((repo) => !repo.private);
}

$("login").addEventListener("click", async () => {
  try {
    const provider = new GithubAuthProvider();
    const result = await signInWithPopup(auth, provider);

    if (!OWNER_UID) {
      status(
        `第一次設定成功！你的 Firebase UID 是：\n${result.user.uid}\n` +
        "請將它填入 app.js 的 OWNER_UID，並設定 Firestore 規則。"
      );
      return;
    }

    if (result.user.uid !== OWNER_UID) {
      await signOut(auth);
      throw new Error("這個帳號不是作品集管理員。");
    }

    const credential = GithubAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error("無法取得 GitHub 授權，請重新登入。");
    }

    $("publish").disabled = true;
    status("正在讀取 GitHub 作品……");

    await loadPortfolio();
    repositories = await fetchRepositories(credential.accessToken);

    renderRepositories();
    status(`已讀取 ${repositories.length} 個公開專案。`);
  } catch (error) {
    showError(error);
  }
});

$("publish").addEventListener("click", async () => {
  $("publish").disabled = true;

  try {
    assertOwner();

    const previous = new Map(githubProjects.map((item) => [item.id, item]));

    const projects = repositories
      .filter((repo) => selectedIds.has(repo.id))
      .map((repo) => {
        const fresh = {
          id: repo.id,
          name: repo.name,
          description: repo.description || "",
          language: repo.language || "",
          githubUrl: repo.html_url,
          demoUrl: repo.homepage || "",
          slidesUrl: "",
          thumbnail: ""
        };

        const old = previous.get(repo.id);
        if (!old) return fresh;

        if (old.edited) {
          return { ...fresh, ...old, githubUrl: repo.html_url };
        }
        return {
          ...fresh,
          thumbnail: old.thumbnail || "",
          slidesUrl: old.slidesUrl || ""
        };
      });

    await persist({ projects });

    githubProjects = projects;
    renderAll();
    status(`發布成功！目前展示 ${projects.length} 個 GitHub 作品。`);
  } catch (error) {
    showError(error);
  } finally {
    $("publish").disabled = false;
  }
});

$("externalForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("addExternal").disabled = true;

  try {
    const name = $("extName").value.trim();
    const description = $("extDescription").value.trim();
    const url = safeUrl($("extUrl").value.trim());
    const slidesText = $("extSlides").value.trim();
    const slidesUrl = slidesText ? safeUrl(slidesText) : "";
    const label = $("extLabel").value.trim() || "網站作品";

    if (!name) throw new Error("請輸入作品名稱。");
    if (!url) throw new Error("請輸入正確的網址，需以 https:// 開頭。");
    if (slidesText && !slidesUrl) {
      throw new Error("簡報連結格式不正確，需以 https:// 開頭。");
    }

    const project = {
      id: `ext-${Date.now()}`,
      name,
      description,
      language: label,
      githubUrl: "",
      demoUrl: url,
      slidesUrl,
      thumbnail: ""
    };

    const next = [...externalProjects, project];
    await persist({ externalProjects: next });
    externalProjects = next;
    renderAll();

    $("externalForm").reset();
    $("extLabel").value = "Google Sites";
    status(`已新增網站作品：${name}`);
  } catch (error) {
    showError(error);
  } finally {
    $("addExternal").disabled = false;
  }
});

$("logout").addEventListener("click", async () => {
  try {
    await signOut(auth);
    status("已登出。");
  } catch (error) {
    showError(error);
  }
});

onAuthStateChanged(auth, (user) => {
  const isOwner = Boolean(OWNER_UID && user?.uid === OWNER_UID);
  $("admin").hidden = !isOwner;

  if (isOwner) {
    $("identity").textContent =
      `管理員：${user.displayName || user.uid}`;
    renderWorkList();
  } else {
    repositories = [];
    $("repos").replaceChildren();
    $("publish").disabled = true;
  }
});

if (OWNER_UID) {
  loadPortfolio().catch(showError);
} else {
  status("初次設定：請先按 GitHub 登入，取得你的 Firebase UID。");
}
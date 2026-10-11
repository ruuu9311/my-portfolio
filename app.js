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

// 貼上你的 Firebase 網頁設定。
const firebaseConfig = {
    apiKey: "AIzaSyCAP-YwWjL-4ALRP8JktQj0nkGMQhTu5t4",
    authDomain: "portfolio-4db38.firebaseapp.com",
    projectId: "portfolio-4db38",
    storageBucket: "portfolio-4db38.firebasestorage.app",
    messagingSenderId: "364487390288",
    appId: "1:364487390288:web:ae2587a56577af32550d55"
};

// 第一次登入取得 UID 後，再填入這裡。
const OWNER_UID = "gShe048rcqPAQYEyRaklHHsE2sJ3";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const portfolioRef = doc(db, "public", "portfolio");

const $ = (id) => document.getElementById(id);
const status = (text) => { $("status").textContent = text; };

let repositories = [];
let selectedIds = new Set();

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

    const title = document.createElement("h3");
    title.textContent = project.name;

    const description = document.createElement("p");
    description.textContent = project.description || "尚未填寫作品介紹";

    const language = document.createElement("p");
    language.className = "muted";
    language.textContent = project.language || "其他";

    card.append(title, description, language);
    addLink(card, "查看 GitHub", project.githubUrl);
    addLink(card, "開啟 Demo", project.demoUrl);

    $("projects").append(card);
  }
}

async function loadPortfolio() {
  const snapshot = await getDoc(portfolioRef);
  const projects = snapshot.exists()
    ? snapshot.data().projects || []
    : [];

  selectedIds = new Set(projects.map((project) => project.id));
  renderProjects(projects);
}

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

  // 分頁取得，避免只顯示前 100 個。
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
    // 不加 repo scope；第一版只讀取公開作品。
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

    // access token 只在這次操作使用，不寫入資料庫或 localStorage。
    renderRepositories();
    status(`已讀取 ${repositories.length} 個公開專案。`);
  } catch (error) {
    showError(error);
  }
});

$("publish").addEventListener("click", async () => {
  $("publish").disabled = true;

  try {
    if (!OWNER_UID || auth.currentUser?.uid !== OWNER_UID) {
      throw new Error("沒有發布權限。");
    }

    const projects = repositories
      .filter((repo) => selectedIds.has(repo.id))
      .map((repo) => ({
        id: repo.id,
        name: repo.name,
        description: repo.description || "",
        language: repo.language || "",
        githubUrl: repo.html_url,
        demoUrl: repo.homepage || ""
      }));

    await setDoc(portfolioRef, {
      projects,
      updatedAt: serverTimestamp()
    });

    renderProjects(projects);
    status(`發布成功！目前展示 ${projects.length} 個作品。`);
  } catch (error) {
    showError(error);
  } finally {
    $("publish").disabled = false;
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
  } else {
    repositories = [];
    $("repos").replaceChildren();
    $("publish").disabled = true;
  }
});

// UID 尚未設定時，先不要讀取受到保護的資料庫。
if (OWNER_UID) {
  loadPortfolio().catch(showError);
} else {
  status("初次設定：請先按 GitHub 登入，取得你的 Firebase UID。");
}
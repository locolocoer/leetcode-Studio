// scripts/lc-cli.ts
import { mkdirSync as mkdirSync2 } from "fs";
import { join as join2 } from "path";

// src/main/leetcode.ts
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
function baseOf(host2) {
  const h = (host2 || "leetcode.com").toLowerCase().replace(/^https?:\/\//, "");
  return h.includes(".") ? `https://${h}` : "https://leetcode.com";
}
function langSlugOf(lang) {
  switch (lang) {
    case "python":
      return "python3";
    case "java":
      return "java";
    case "cpp":
      return "cpp";
    case "c":
      return "c";
  }
  return null;
}
var LeetCodeClient = class {
  jar = {};
  sessionFile;
  constructor(dataDir) {
    this.sessionFile = join(dataDir, "lc-session.json");
    try {
      this.jar = JSON.parse(readFileSync(this.sessionFile, "utf8"));
    } catch {
      this.jar = {};
    }
  }
  save() {
    mkdirSync(join(this.sessionFile, ".."), { recursive: true });
    writeFileSync(this.sessionFile, JSON.stringify(this.jar, null, 2), "utf8");
  }
  jarOf(host2) {
    if (!this.jar[host2]) this.jar[host2] = {};
    return this.jar[host2];
  }
  headers(host2, extra) {
    const j = this.jarOf(host2);
    const h = { "User-Agent": UA, ...extra };
    const cookies = [];
    if (j.csrf) cookies.push(`csrftoken=${j.csrf}`);
    if (j.session) cookies.push(`LEETCODE_SESSION=${j.session}`);
    if (cookies.length) h.Cookie = cookies.join("; ");
    return h;
  }
  capture(res, host2) {
    const j = this.jarOf(host2);
    let scs = [];
    try {
      scs = res.headers.getSetCookie?.() || [];
    } catch {
      scs = [];
    }
    for (const sc of scs) {
      const [pair] = sc.split(";");
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const val = pair.slice(eq + 1).trim();
      if (name === "csrftoken") j.csrf = val;
      else if (name === "LEETCODE_SESSION") j.session = val;
    }
  }
  status(host2) {
    const j = this.jarOf(host2);
    return { host: host2, loggedIn: !!j.session, username: j.username };
  }
  async whoami(host2) {
    const base = baseOf(host2);
    try {
      const res = await fetch(`${base}/api/problems/all/`, { headers: this.headers(host2), redirect: "follow" });
      if (!res.ok) return void 0;
      const data = await res.json();
      const u = data?.user_name;
      if (typeof u === "string" && u.trim()) {
        this.jarOf(host2).username = u.trim();
        this.save();
        return u.trim();
      }
    } catch {
    }
    return void 0;
  }
  async logout(host2) {
    delete this.jar[host2];
    this.save();
  }
  async login(host2, username, password) {
    const base = baseOf(host2);
    const j = this.jarOf(host2);
    try {
      const page = await fetch(`${base}/accounts/login/`, {
        headers: { "User-Agent": UA },
        redirect: "manual"
      });
      this.capture(page, host2);
      if (!j.csrf) {
        const html = await page.text();
        const m = html.match(/name="csrfmiddlewaretoken" value="([^"]+)"/);
        if (m) j.csrf = m[1];
      }
    } catch (e) {
      return { host: host2, loggedIn: false, ok: false, error: `\u65E0\u6CD5\u8FDE\u63A5\u767B\u5F55\u9875\uFF1A${e?.message || e}` };
    }
    if (!j.csrf) {
      return { host: host2, loggedIn: false, ok: false, error: "\u672A\u80FD\u83B7\u53D6 CSRF token\uFF08\u53EF\u80FD\u7F51\u7EDC\u53D7\u9650\u6216\u88AB\u9A8C\u8BC1\u7801\u62E6\u622A\uFF09" };
    }
    const form = new URLSearchParams();
    form.set("csrfmiddlewaretoken", j.csrf);
    form.set("login", username);
    form.set("password", password);
    form.set("next", "/");
    try {
      const res = await fetch(`${base}/accounts/login/`, {
        method: "POST",
        redirect: "manual",
        headers: {
          "User-Agent": UA,
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: `csrftoken=${j.csrf}`,
          Referer: `${base}/accounts/login/`
        },
        body: form.toString()
      });
      this.capture(res, host2);
      if (res.status === 302 && !j.session) {
        const loc = res.headers.get("location") || "";
        if (loc.includes("two_factor")) {
          return { host: host2, loggedIn: false, ok: false, error: "\u8BE5\u8D26\u53F7\u542F\u7528\u4E86\u4E24\u6B65\u9A8C\u8BC1\uFF0C\u6682\u4E0D\u652F\u6301\u81EA\u52A8\u5316\u767B\u5F55\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5\u3002" };
        }
      }
      if (!j.session) {
        let err = "\u7528\u6237\u540D\u6216\u5BC6\u7801\u9519\u8BEF\uFF0C\u6216\u767B\u5F55\u88AB\u62E6\u622A\u3002";
        try {
          const html = await res.text();
          if (/Captcha/i.test(html)) err = "\u767B\u5F55\u8981\u6C42\u4EBA\u673A\u9A8C\u8BC1\uFF08Captcha\uFF09\uFF0C\u8BF7\u7A0D\u540E\u6216\u6539\u7528\u7AD9\u70B9\u9875\u9762\u767B\u5F55\u3002";
          else if (/incorrect|valid login/i.test(html)) err = "\u7528\u6237\u540D\u6216\u5BC6\u7801\u4E0D\u6B63\u786E\u3002";
        } catch {
        }
        return { host: host2, loggedIn: false, ok: false, error: err };
      }
    } catch (e) {
      return { host: host2, loggedIn: false, ok: false, error: `\u767B\u5F55\u8BF7\u6C42\u5931\u8D25\uFF1A${e?.message || e}` };
    }
    j.username = username;
    this.save();
    const real = await this.whoami(host2);
    if (real) j.username = real;
    else {
      const profile = await fetch(`${base}/u/${username}/`, { headers: this.headers(host2), redirect: "follow" });
      this.capture(profile, host2);
    }
    this.save();
    return { host: host2, loggedIn: true, username: j.username || username, ok: true };
  }
  async importSession(host2, session, csrf) {
    const j = this.jarOf(host2);
    j.session = session.trim();
    if (csrf) j.csrf = csrf.trim();
    this.save();
    const u = await this.whoami(host2);
    if (!u) {
      return { host: host2, loggedIn: true, ok: true, error: "\u4F1A\u8BDD\u5DF2\u4FDD\u5B58\uFF0C\u4F46\u672A\u80FD\u786E\u8BA4\u7528\u6237\u540D\uFF08\u4F1A\u8BDD\u53EF\u80FD\u5DF2\u8FC7\u671F\uFF09\u3002" };
    }
    j.username = u;
    this.save();
    return { host: host2, loggedIn: true, username: u, ok: true };
  }
  async importSessionFromText(host2, text) {
    const t = (text || "").replace(/^cookie\s*:/i, "").trim();
    if (!t) return { host: host2, loggedIn: false, ok: false, error: "Cookie \u5185\u5BB9\u4E3A\u7A7A" };
    let session = "";
    let csrf = "";
    for (const part of t.split(";")) {
      const eq = part.indexOf("=");
      if (eq <= 0) continue;
      const name = part.slice(0, eq).trim();
      const val = part.slice(eq + 1).trim();
      if (name === "LEETCODE_SESSION") session = val;
      else if (name === "csrftoken") csrf = val;
    }
    if (!session) {
      return { host: host2, loggedIn: false, ok: false, error: "\u672A\u627E\u5230 LEETCODE_SESSION\u3002\u8BF7\u7C98\u8D34\u6D4F\u89C8\u5668\u91CC\u7684\u5B8C\u6574 Cookie\u3002" };
    }
    return this.importSession(host2, session, csrf);
  }
  async submit(host2, slug, questionId, lang, code) {
    const base = baseOf(host2);
    const j = this.jarOf(host2);
    if (!j.session) return { ok: false, accepted: false, status: "\u672A\u767B\u5F55", error: "\u8BF7\u5148\u767B\u5F55 LeetCode \u8D26\u53F7" };
    const lslug = langSlugOf(lang);
    if (!lslug) return { ok: false, accepted: false, status: "\u4E0D\u652F\u6301\u7684\u8BED\u8A00", error: "\u8BE5\u8BED\u8A00\u4E0D\u652F\u6301\u63D0\u4EA4" };
    const qid = Number(questionId);
    if (!Number.isInteger(qid) || qid <= 0) {
      return { ok: false, accepted: false, status: "\u7F3A\u5C11\u9898\u76EE ID", error: "\u4EC5\u652F\u6301\u63D0\u4EA4\u4ECE LeetCode \u62C9\u53D6\u7684\u9898\u76EE\u6216\u5185\u7F6E\u793A\u4F8B\u9898\u3002" };
    }
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return { ok: false, accepted: false, status: "\u7F3A\u5C11\u9898\u76EE\u6807\u8BC6", error: "\u9898\u76EE\u7F3A\u5C11\u6709\u6548\u7684 title slug\u3002" };
    }
    let subId;
    try {
      const res = await fetch(`${base}/problems/${slug}/submit/`, {
        method: "POST",
        headers: this.headers(host2, {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "X-CSRFToken": j.csrf || "",
          Referer: `${base}/problems/${slug}/`
        }),
        body: JSON.stringify({ lang: lslug, question_id: qid, typed_code: code })
      });
      this.capture(res, host2);
      const txt = await res.text();
      let data;
      try {
        data = JSON.parse(txt);
      } catch {
        data = null;
      }
      if (data?.submission_id != null) subId = Number(data.submission_id);
      else {
        const msg = data?.error || data?.msg || data?.detail || txt.slice(0, 200);
        if (res.status === 429) return { ok: false, accepted: false, status: "\u9891\u7387\u9650\u5236", error: "\u63D0\u4EA4\u8FC7\u4E8E\u9891\u7E41\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5\u3002" };
        return { ok: false, accepted: false, status: "\u63D0\u4EA4\u5931\u8D25", error: `\u63D0\u4EA4\u88AB\u62D2\u7EDD\uFF1A${msg}` };
      }
    } catch (e) {
      return { ok: false, accepted: false, status: "\u7F51\u7EDC\u9519\u8BEF", error: `\u63D0\u4EA4\u8BF7\u6C42\u5931\u8D25\uFF1A${e?.message || e}` };
    }
    const deadline = Date.now() + 6e4;
    while (Date.now() < deadline) {
      await sleep(1200);
      try {
        const res = await fetch(`${base}/submissions/detail/${subId}/check/`, {
          headers: this.headers(host2, { Referer: `${base}/problems/${slug}/` })
        });
        this.capture(res, host2);
        const data = await res.json();
        if (data.state === "SUCCESS") {
          return buildVerdict(data, subId);
        }
        if (data.state && data.state !== "PENDING" && data.state !== "STARTED") {
          return { ok: false, accepted: false, status: data.state, error: JSON.stringify(data).slice(0, 300) };
        }
      } catch (e) {
        return { ok: false, accepted: false, status: "\u7F51\u7EDC\u9519\u8BEF", error: `\u67E5\u8BE2\u8BC4\u6D4B\u7ED3\u679C\u5931\u8D25\uFF1A${e?.message || e}` };
      }
    }
    return { ok: false, accepted: false, status: "\u8D85\u65F6", error: "\u8BC4\u6D4B\u8D85\u65F6\uFF08>60s\uFF09\uFF0C\u8BF7\u5230 LeetCode \u7F51\u9875\u67E5\u770B\u7ED3\u679C\u3002" };
  }
};
function buildVerdict(data, submissionId) {
  const msg = data.status_msg || "Unknown";
  const accepted = msg === "Accepted";
  const v = {
    ok: true,
    accepted,
    status: msg,
    submissionId,
    totalCases: data.total_testcases,
    passedCases: accepted ? data.total_testcases : data.total_correct
  };
  if (data.runtime != null) v.runtime = String(data.runtime);
  if (data.memory != null) v.memory = String(data.memory);
  if (!accepted) {
    v.lastTestcase = data.last_testcase || void 0;
    v.expectedOutput = data.expected_output || void 0;
    v.actualOutput = data.code_output || data.output || void 0;
    if (msg === "Compile Error") v.error = data.compile_error || "\u7F16\u8BD1\u9519\u8BEF";
    else if (msg === "Runtime Error") v.error = data.runtime_error || "\u8FD0\u884C\u9519\u8BEF";
    else if (msg === "Time Limit Exceeded" || msg === "Memory Limit Exceeded") v.error = "\u8BF7\u5728 LeetCode \u67E5\u770B\u8BE6\u7EC6\u5806\u6808";
  }
  return v;
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// scripts/lc-cli.ts
var dir = join2(process.cwd(), ".lc-test");
mkdirSync2(dir, { recursive: true });
var host = process.argv[2] || "leetcode.com";
var user = process.argv[3] || "definitely_not_a_real_user_xyz";
var pass = process.argv[4] || "wrongpass";
var c = new LeetCodeClient(dir);
console.log("initial status:", JSON.stringify(c.status(host)));
var fake = "csrftoken=abcdef123456; LEETCODE_SESSION=fake_session_value_12345; other=1";
console.log("import fake cookie:", JSON.stringify(await c.importSessionFromText(host, fake)));
console.log("submit without valid session:", JSON.stringify(await c.submit(host, "two-sum", "1", "python", "class Solution:\n    pass\n")));

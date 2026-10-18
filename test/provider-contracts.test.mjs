import test from "node:test";
import assert from "node:assert/strict";
import { createServer, IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { attrs, el, escapeHtml } from "../dist/html.mjs";
import { decodeTheme, render, minimal, atelier, themePalette } from "../dist/theming/index.mjs";
import { themePalette as canonicalPalette } from "@red-cup-engineering/web-theming-service/theming-computer";
import * as canonicalTheming from "@red-cup-engineering/web-theming-service/theming";
import { nativeHttpHandler } from "@red-cup-engineering/computer-web-server/native-application";
import { getSignedCookie } from "../dist/session-carrier/cookies.mjs";
import { signCookieValue, unsignCookieValue, serializeCookieHeader } from "@red-cup-engineering/computing-with-http/codecs/cookie";
import { signCookieValue as canonicalSign } from "@red-cup-engineering/computer-serialized-content-engineering-services-section/services/http-data-services-section/src/signed-cookie";

test("canonical HTML preserves established ordinary rendering and exposes its CR/NUL normalization", () => {
  assert.equal(escapeHtml('&<>"\''), "&amp;&lt;&gt;&quot;&#39;");
  for (const value of [undefined, null]) assert.equal(escapeHtml(value), "");
  assert.equal(attrs({ hidden: true, off: false, nil: null, missing: undefined, title: '"<&' }), ' hidden title="&quot;&lt;&amp;"');
  assert.equal(el("img", { src: "a&b" }), '<img src="a&amp;b" />');
  assert.equal(el("div", null, ["<b>trusted</b>", "text"]), "<div><b>trusted</b>text</div>");
  // Explicit canonical-owner migration: legacy HTML emitted raw CR and NUL.
  assert.equal(escapeHtml("a\rb\0c"), "a&#13;b\uFFFDc");
  const article = "<article>a\rb\0c &amp; trusted</article>";
  for (const theme of [minimal, atelier]) {
    const page = render(theme, article, { title: "a\rb\0c" });
    assert.ok(page.includes(article), "article bytes must remain intact");
    assert.ok(page.includes("<title>a&#13;b\uFFFDc</title>"));
  }
});

test("canonical HTTP reads existing signed cookies without changing bytes or refusal policy", () => {
  const req = new IncomingMessage(new Socket());
  const secret = "fixture-key", name = "session";
  assert.equal(getSignedCookie(req, name, secret), null);
  for (const value of ["session-123", "dotted.session", "caf\u00e9/\u96ea", ""]){
    const old = signCookieValue(value, secret, name);
    assert.equal(canonicalSign(value, secret, name), old);
    assert.equal(unsignCookieValue(canonicalSign(value, secret, name), secret, name), value || null);
    req.headers.cookie = serializeCookieHeader({ [name]: old });
    assert.equal(getSignedCookie(req, name, secret), value || null);
    assert.equal(getSignedCookie(req, name, "wrong-key"), null);
    req.headers.cookie = serializeCookieHeader({ [name]: old + "x" });
    assert.equal(getSignedCookie(req, name, secret), null);
    req.headers.cookie = serializeCookieHeader({ other: old });
    assert.equal(getSignedCookie(req, "other", secret), null);
  }
  req.headers.cookie = "session=unsigned; session=ignored; broken";
  assert.equal(getSignedCookie(req, name, secret), null);
  assert.throws(() => getSignedCookie(req, "bad name", secret), TypeError);
});


test("canonical Data themes reach native HTTP, preserving articles, omitting empty navigation and refusing lossy rendering", async () => {
  assert.equal(themePalette, canonicalPalette);
  for (const [name, value] of Object.entries({ decodeTheme, render, minimal, atelier })) {
    assert.equal(value, canonicalTheming[name], `${name} must come from its Data owner`);
  }
  const article = "<article><p>Received shared palette &amp; unchanged body.</p></article>";
  let completed = 0;
  const server = createServer(nativeHttpHandler({ resources: [{
    match: "/theme", methods: ["GET"], handler(ctx) {
      const theme = decodeTheme({ name: "received", seeds: {
        ink: "#0a0a0a", surface: "#f2ead8", accent: ctx.url.searchParams.get("accent"),
      }, type: { sans: "system-ui" } });
      const body = render(theme, article, { title: "Shared CSS registry" });
      completed++;
      return { type: "text/html; charset=utf-8", body };
    },
  }, {
    match: "/theme-shell", methods: ["GET"], handler(ctx) {
      const theme = ctx.url.searchParams.get("theme") === "atelier" ? atelier : minimal;
      const nav = [null, {}, { href: 42, label: "invalid" }];
      if (ctx.url.searchParams.get("nav") === "mixed") nav.push({ href: "/a?x=1&y=2", label: "A&B", current: true });
      const selected = ctx.url.searchParams.has("lossy") ? { ...theme, wrap: () => "<p>dropped</p>" } : theme;
      const body = render(selected, article, { title: "Shared <shell>", nav });
      return { type: "text/html; charset=utf-8", body };
    },
  }] }));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const accent of ["#3d5588", "#ff4530"]) {
      const reply = await fetch(`${origin}/theme?accent=${encodeURIComponent(accent)}`);
      assert.equal(reply.status, 200);
      assert.match(reply.headers.get("content-type"), /text\/html/);
      const body = await reply.text();
      assert.ok(body.includes(article));
      assert.ok(body.includes(`--accent: ${accent}`));
      assert.match(body, /@media \(prefers-color-scheme: dark\)/);
    }
    for (const theme of ["minimal", "atelier"]) {
      for (const nav of ["empty", "mixed"]) {
        const reply = await fetch(`${origin}/theme-shell?theme=${theme}&nav=${nav}`);
        assert.equal(reply.status, 200);
        const body = await reply.text();
        assert.ok(body.includes(article));
        assert.ok(body.includes("<title>Shared &lt;shell&gt;</title>"));
        if (nav === "empty") assert.doesNotMatch(body, /<nav\b/);
        else assert.ok(body.includes('<a href="/a?x=1&amp;y=2" aria-current="page">A&amp;B</a>'));
      }
    }
    const lossy = await fetch(`${origin}/theme-shell?lossy`);
    assert.equal(lossy.status, 500);
    await lossy.text();
    const refused = await fetch(`${origin}/theme?accent=%231g0000`);
    assert.equal(refused.status, 500);
    await refused.text();
    assert.equal(completed, 2, "malformed input must not reach completed HTML delivery");
  } finally {
    server.closeIdleConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

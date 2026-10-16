import test from "node:test";
import assert from "node:assert/strict";
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { attrs, el, escapeHtml } from "../dist/html.mjs";
import { render, minimal, atelier } from "../dist/theming/index.mjs";
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

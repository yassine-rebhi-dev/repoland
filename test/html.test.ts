import { describe, expect, it } from "vitest";
import { htmlPage, scriptJson } from "../src/html.js";
import { parseScene } from "../src/scene.js";

describe("htmlPage", () => {
  const scene = parseScene({ title: "x</script><b>", nodes: [{ id: "a", label: "</script><img onerror=alert(1)>", kind: "service" }], edges: [] });
  it("embeds scene and viewer without letting content close the script tag", () => {
    const html = htmlPage(scene, "var Repoland={mount(){}};/*</script>*/");
    const scripts = html.match(/<script>/g)!.length;
    expect(html.match(/<\/script>/g)!.length).toBe(scripts);
    expect(html).not.toContain("<img onerror");
    expect(html).toContain("Repoland.mount");
  });
  it("scriptJson round-trips", () => {
    const v = { s: "a</b> c" };
    expect(JSON.parse(scriptJson(v))).toEqual(v);
  });
});

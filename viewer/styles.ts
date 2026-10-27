/** Scoped styles for the 3D viewer (everything under .rl-root). */
export const STYLES = `
.rl-root{position:relative;overflow:hidden;background:radial-gradient(120% 90% at 30% 0%,#ffffff 0%,#eef2f8 45%,#dde5ef 100%);font:400 14px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#17202e;min-height:420px;border-radius:14px}
.rl-root canvas{display:block}
.rl-labels{position:absolute;inset:0;z-index:1}
.rl-anchor{width:0;height:0}
.rl-label{position:absolute;left:0;bottom:6px;transform:translateX(-50%);background:#fff;border:1.2px solid color-mix(in srgb,var(--k) 75%,#000);border-radius:8px;padding:4px 9px 4px 22px;cursor:pointer;box-shadow:0 6px 16px -10px rgba(23,32,46,.5);white-space:nowrap;transition:opacity .2s}
.rl-label::after{content:"";position:absolute;left:50%;bottom:-6px;margin-left:-5px;border:5px solid transparent;border-top-color:#fff;border-bottom:0}
.rl-label::before{content:"";position:absolute;left:9px;top:9px;width:7px;height:7px;border-radius:2px;background:var(--k)}
.rl-label b{display:block;font-size:13px;font-weight:650}
.rl-label span{display:none;font-size:11px;color:#5a6475}
.rl-label.is-hover span,.rl-label.is-selected span{display:block}
.rl-label.is-hover,.rl-label.is-selected{z-index:2}
.rl-label.is-dim{opacity:.25}
.rl-label.is-selected{outline:3px solid color-mix(in srgb,var(--k) 55%,transparent);outline-offset:2px}
.rl-label.is-changed{border-color:#e5484d;box-shadow:0 0 0 3px rgba(229,72,77,.25)}
.rl-label.is-affected{border-color:#f5a524;box-shadow:0 0 0 3px rgba(245,165,36,.25)}
.rl-edge{background:#fff;border:1px solid #c7d1de;border-radius:999px;padding:1px 8px;font-size:11px;color:#3d4757;pointer-events:none}
.rl-zone{font-size:12px;font-weight:600;color:#3d4757;background:rgba(255,255,255,.75);padding:2px 8px;border-radius:6px;pointer-events:none}
.rl-bar{position:absolute;z-index:3;left:14px;right:14px;top:12px;display:flex;flex-wrap:wrap;gap:8px 14px;align-items:flex-start;pointer-events:none}
.rl-bar>*{pointer-events:auto}
.rl-title{flex:1 1 220px;min-width:0}
.rl-title strong{display:block;font-size:20px;font-weight:750;letter-spacing:-.01em}
.rl-title span{display:block;color:#5a6475;font-size:13px}
.rl-tools{display:flex;gap:6px}
.rl-search{font:inherit;border:1px solid #c7d1de;background:rgba(255,255,255,.92);border-radius:9px;padding:7px 10px;width:180px;color:#17202e}
.rl-btn{font:inherit;border:1px solid #c7d1de;background:rgba(255,255,255,.92);border-radius:9px;padding:7px 11px;cursor:pointer;color:#17202e}
.rl-color{font:inherit;border:1px solid #c7d1de;background:rgba(255,255,255,.92);border-radius:9px;padding:6px 8px;color:#17202e}
.rl-legend{flex-basis:100%;display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px;color:#3d4757}
.rl-legend:empty{display:none}
.rl-legend span{position:relative;padding-left:16px}
.rl-legend span::before{content:"";position:absolute;left:0;top:50%;width:11px;height:11px;margin-top:-6px;border-radius:3px;background:var(--k)}
.rl-districts{flex-basis:100%;display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px;color:#3d4757}
.rl-districts span{position:relative;padding-left:16px}
.rl-districts span::before{content:"";position:absolute;left:0;top:50%;width:11px;height:11px;margin-top:-6px;border-radius:3px;background:color-mix(in srgb,var(--k) 35%,transparent);border:1px solid var(--k)}
.rl-kinds{flex-basis:100%;display:flex;flex-wrap:wrap;gap:6px}
.rl-chip{font:inherit;font-size:12px;border:1px solid #c7d1de;background:rgba(255,255,255,.92);border-radius:999px;padding:3px 10px 3px 22px;cursor:pointer;position:relative;color:#17202e}
.rl-chip::before{content:"";position:absolute;left:9px;top:50%;width:8px;height:8px;margin-top:-4px;border-radius:2px;background:var(--k)}
.rl-chip[aria-pressed=false]{opacity:.45;text-decoration:line-through}
.rl-panel{position:absolute;z-index:4;right:12px;top:130px;bottom:12px;width:min(300px,calc(100% - 24px));overflow:auto;background:rgba(255,255,255,.96);border:1px solid #d5dde8;border-radius:12px;padding:14px 16px;box-shadow:0 18px 40px -24px rgba(23,32,46,.5)}
.rl-panel h3{margin:2px 0 4px;font-size:18px}
.rl-panel h4{margin:14px 0 4px;font-size:12px;color:#5a6475;font-weight:600}
.rl-panel p{margin:0 0 6px}
.rl-panel ul{margin:0;padding-left:18px}
.rl-panel li{margin:2px 0}
.rl-panel code{font:12px ui-monospace,Menlo,monospace;background:#eef2f7;padding:1px 5px;border-radius:4px}
.rl-kind{font-size:12px;color:#5a6475;padding-left:14px;position:relative}
.rl-kind::before{content:"";position:absolute;left:0;top:50%;width:8px;height:8px;margin-top:-4px;border-radius:2px;background:var(--k)}
.rl-note{color:#5a6475}
.rl-link{font:inherit;background:none;border:0;padding:0;color:#4b42e0;cursor:pointer;text-decoration:underline;text-underline-offset:2px}
.rl-close{position:absolute;right:8px;top:6px;font-size:20px;line-height:1;background:none;border:0;cursor:pointer;color:#5a6475}
.rl-hint{position:absolute;z-index:3;left:14px;bottom:10px;font-size:12px;color:#5a6475;background:rgba(255,255,255,.7);padding:3px 8px;border-radius:6px;pointer-events:none}
.rl-root button:focus-visible,.rl-search:focus-visible{outline:3px solid #6c63ff;outline-offset:2px}
.rl-narrow .rl-kinds,.rl-narrow .rl-districts,.rl-narrow .rl-color,.rl-narrow .rl-title span{display:none}
.rl-narrow .rl-tools{flex-basis:100%}
.rl-narrow .rl-search{flex:1}
@media (max-width:600px){.rl-search{width:130px}.rl-panel{top:auto;height:45%}.rl-title strong{font-size:17px}}
@media (prefers-reduced-motion:reduce){.rl-label{transition:none}}
`;

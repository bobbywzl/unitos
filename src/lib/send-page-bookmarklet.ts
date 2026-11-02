// The bookmarklet that sends a page from the reader's browser (SPEC.md §15):
// the page's HTML as the browser shows it — signed in, past the site's
// bot wall — posted to /share/target with its address and title. The
// browser opens Unitos in a new tab, where the reader picks the project.
// Scripts, frames, icons, and stylesheet links leave first: the parser
// reads the markup, and a news page's scripts alone can pass the cap.
export function sendPageBookmarklet(origin: string): string {
  const action = `${origin.replace(/\/$/, "")}/share/target`;
  const code = [
    "(function(){",
    "var d=document.documentElement.cloneNode(true);",
    "d.querySelectorAll('script,noscript,iframe,svg,link,template,video,audio,canvas').forEach(function(e){e.remove()});",
    "var f=document.createElement('form');",
    "f.method='POST';f.enctype='multipart/form-data';",
    `f.action=${JSON.stringify(action)};`,
    "f.target='_blank';f.style.display='none';",
    "function a(n,v){var i=document.createElement('textarea');i.name=n;i.value=v;f.appendChild(i)}",
    "a('url',location.href);a('title',document.title);",
    "a('html','<!doctype html>'+d.outerHTML);",
    "document.body.appendChild(f);f.submit();f.remove();",
    "})();",
  ].join("");
  return `javascript:${encodeURIComponent(code)}`;
}

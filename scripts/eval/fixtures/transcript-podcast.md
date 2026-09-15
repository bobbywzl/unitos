# Interview: building a reading tool

[0:00–0:14] Host: You built a tool for reading documents with an AI assistant. Why not just use a chat window?
[0:14–0:48] Guest: Because a chat window forgets where the answer came from. When I ask a question about a hundred-page report, I do not want a paragraph of prose. I want the three passages that answer it, in the document's own words, and I want to click on each one and land there. Provenance is the product. The prose is just the caption.
[0:48–1:05] Host: So every answer points back into the document.
[1:05–1:42] Guest: Every claim. If the assistant says the margin was 9.1 percent, that number has a source, and the source is a span of text you can see. We store the span two ways: by block and offsets, and by the quoted text with a little context on either side. If the document gets re-parsed and the blocks change, the quote finds its place again.
[1:42–1:58] Host: What happens when the quote is not there anymore?
[1:58–2:20] Guest: Then we say so. The note shows the quoted text with a broken-link mark. We never silently drop it and we never guess. A wrong citation is worse than a missing one.
[2:20–2:40] Host: Let's talk about the reader's background. You inject it into every prompt?
[2:40–3:15] Guest: Every prompt. A reader who says "I am a lawyer reading this for a deal" gets a different explanation than a reader who says "I am a first-year student". Same passage, same facts, different words and different emphasis. The trick is to let the background change what gets explained, not what is true.
[3:15–3:30] Host: Does that ever go wrong?
[3:30–3:58] Guest: It goes wrong when the model forces a connection. If the passage is about attention mechanisms and the reader is a lawyer, the model wants to say something about legal implications. There are none. So the prompt says: connect to the reader's purpose when the connection is real, and skip forced connections. That one line fixed most of it.
[3:58–4:20] Host: Last question. What would you tell someone building the same thing?
[4:20–4:55] Guest: Two things. Never let AI output enter the reader's notes without a keystroke from the reader. And measure the tools. We rate every answer, thumbs up or down, and the poor ones become test cases. A prompt you cannot measure is a prompt you cannot improve.

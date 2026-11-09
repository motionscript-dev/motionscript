# Fonts

Drop a `.ttf`/`.otf` here and restart the server: the file's name becomes the
family, so `Inter.ttf` registers as `Inter` (a trailing `-Regular`/`-Book` is
stripped).

An undeclared family is never fetched, and the page shapes its text against a
fallback face. That is why the **Text** scene answers 409 until one is here,
rather than rendering the wrong type.

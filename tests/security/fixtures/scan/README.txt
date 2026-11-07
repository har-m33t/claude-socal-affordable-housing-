Fake source trees for tests/security/no-send.test.ts. Not real code.
Files end in ".fixture" so tsc and Next never compile them; the scanner strips the
suffix and scans them as if they were real app/, lib/ and components/ files.
unsafe/ must produce every expected violation; safe/ must produce none.
All URLs use example.com/example.gov placeholders.

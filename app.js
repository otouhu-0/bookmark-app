const express = require('express');
const Database = require('better-sqlite3');
const axios = require('axios');
const cheerio = require('cheerio');
const session = require('express-session');

const app = express();
const db = new Database('bookmarks.db');

// ★ テーブルに click_count と is_favorite を追加
db.exec(`
  CREATE TABLE IF NOT EXISTS bookmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    url TEXT,
    tag TEXT,
    image_url TEXT,
    click_count INTEGER DEFAULT 0,
    is_favorite INTEGER DEFAULT 0
  )
`);

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: 'my-secret-key',
    resave: false,
    saveUninitialized: false
}));

function requireLogin(req, res, next) {
    if (req.session.loggedIn) {
        next();
    } else {
        res.redirect('/login');
    }
}

async function fetchMetadata(url) {
    try {
        const response = await axios.get(url, { timeout: 5000 });
        const $ = cheerio.load(response.data);
        const title = $('meta[property="og:title"]').attr('content') || $('title').text().trim() || "タイトルなし";
        const imageUrl = $('meta[property="og:image"]').attr('content') || "";
        return { title, imageUrl };
    } catch (error) {
        return { title: "タイトルなし", imageUrl: "" };
    }
}

// ==============
// ルーティング
// ==============

app.get('/login', (req, res) => res.render('login', { error: null }));
app.post('/login', (req, res) => {
    if (req.body.password === 'pro123') {
        req.session.loggedIn = true;
        res.redirect('/');
    } else {
        res.render('login', { error: 'パスワードが違います' });
    }
});
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// --- メイン画面（並べ替えロジックの修正） ---
app.get('/', requireLogin, (req, res) => {
    const search_tag = req.query.search_tag || '';
    const show_fav = req.query.show_fav === '1';
    const sort_by = req.query.sort_by || 'new';

    let query = 'SELECT * FROM bookmarks WHERE 1=1';
    let params = [];

    if (search_tag) {
        query += ' AND tag = ?';
        params.push(search_tag);
    }
    if (show_fav) {
        query += ' AND is_favorite = 1';
    }

    // ★ 並べ替えルールの分岐に「old」を追加
    if (sort_by === 'clicks') {
        query += ' ORDER BY click_count DESC, id DESC';
    } else if (sort_by === 'old') {
        query += ' ORDER BY id ASC';   // 古い順（IDが小さい順）
    } else {
        query += ' ORDER BY id DESC';  // 新しい順（デフォルト）
    }

    const stmt = db.prepare(query);
    const bookmarks = stmt.all(...params);
    res.render('index', { bookmarks, search_tag, show_fav, sort_by });
});

// --- 追加機能 ---
app.post('/add', requireLogin, async (req, res) => {
    const url = req.body.url;
    let title = req.body.title;
    const tag = req.body.tag || "未分類";

    if (url) {
        let imageUrl = "";
        if (!title) {
            const meta = await fetchMetadata(url);
            title = meta.title;
            imageUrl = meta.imageUrl;
        }
        const stmt = db.prepare('INSERT INTO bookmarks (title, url, tag, image_url) VALUES (?, ?, ?, ?)');
        stmt.run(title, url, tag, imageUrl);
    }
    res.redirect('/');
});

// --- 【新規】クリック回数を増やす処理 ---
app.get('/click/:id', requireLogin, (req, res) => {
    const id = req.params.id;
    const b = db.prepare('SELECT url FROM bookmarks WHERE id = ?').get(id);
    if (b) {
        // カウントを1増やして、元のURLに転送する
        db.prepare('UPDATE bookmarks SET click_count = click_count + 1 WHERE id = ?').run(id);
        res.redirect(b.url);
    } else {
        res.redirect('/');
    }
});

// --- 【新規】お気に入りを切り替える処理 ---
app.post('/favorite/:id', requireLogin, (req, res) => {
    const id = req.params.id;
    const b = db.prepare('SELECT is_favorite FROM bookmarks WHERE id = ?').get(id);
    if (b) {
        // 0なら1に、1なら0に反転させる
        const newFav = b.is_favorite ? 0 : 1;
        db.prepare('UPDATE bookmarks SET is_favorite = ? WHERE id = ?').run(newFav, id);
    }
    res.redirect('back'); // 同じページ（検索条件を維持したまま）に戻る
});

// --- 編集・削除 ---
app.get('/edit/:id', requireLogin, (req, res) => {
    const b = db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(req.params.id);
    res.render('edit', { b });
});
app.post('/edit/:id', requireLogin, (req, res) => {
    db.prepare('UPDATE bookmarks SET title = ?, url = ?, tag = ? WHERE id = ?').run(req.body.title, req.body.url, req.body.tag, req.params.id);
    res.redirect('/');
});
app.post('/delete/:id', requireLogin, (req, res) => {
    db.prepare('DELETE FROM bookmarks WHERE id = ?').run(req.params.id);
    res.redirect('/');
});

// app.js の一番下の修正
const PORT = process.env.PORT || 9000; // 公開サーバーのポート番号、なければ9000を使う

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});
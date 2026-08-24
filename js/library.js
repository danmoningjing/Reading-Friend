/* ============================================================
   书库注册表（library.js）
   ------------------------------------------------------------
   想加一本书：在 js/books/ 里建一个数据文件，然后在这里的
   LIBRARY 数组里加一项即可（或用 window.BOOK_xxx 引用）。
   ============================================================ */

const LIBRARY = [
  {
    id: "homer",
    title: "荷马史诗",
    subtitle: "伊利亚特 · 奥德赛（48 卷）",
    icon: "🏛️",
    parts: [
      {
        id: "iliad",
        name: "伊利亚特",
        en: "Iliad",
        unit: "卷",
        intro: HOMER.epics.iliad.intro,
        books: HOMER.epics.iliad.books
      },
      {
        id: "odyssey",
        name: "奥德赛",
        en: "Odyssey",
        unit: "卷",
        intro: HOMER.epics.odyssey.intro,
        books: HOMER.epics.odyssey.books
      }
    ],
    glossary: HOMER.glossary,
    themes: HOMER.themes
  }
];

// 演示书（js/books/demo.js，可删除）
if (typeof window !== "undefined" && window.BOOK_DEMO) {
  LIBRARY.push(window.BOOK_DEMO);
}
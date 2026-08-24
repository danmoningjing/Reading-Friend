/* ============================================================
   新书模板（TEMPLATE.js）——不会被应用加载，仅作复制参考
   ------------------------------------------------------------
   用法：
   1. 复制本文件为 js/books/你的书.js
   2. 填写下方内容（把 window.BOOK_TEMPLATE 改成 window.BOOK_你的ID）
   3. 在 index.html 的 <script> 里加载该文件
   4. 在 js/library.js 的 LIBRARY 数组里加一项
   ============================================================ */
window.BOOK_TEMPLATE = {
  id: "your-book-id",                 // 唯一标识（英文/数字）
  title: "你的书名",                   // 显示名
  subtitle: "副标题（可选）",
  icon: "📖",
  parts: [                             // 分部/卷组（如"正文"或"上卷/下卷"）
    {
      id: "main",                      // 分部标识
      name: "正文",
      en: "Main",
      unit: "章",                      // 单位：章 / 卷 / 篇
      intro: "一句话介绍这一部。",
      books: [
        {
          n: 1,
          title: "第一章标题",
          preview: "这章讲什么（导读）：2~3 句。",
          characters: ["人物A", "人物B"],
          places: ["地点"],
          terms: ["关键概念"],
          focus: [
            { where: "第 X 页 / 第 X 段", why: "为什么值得精读" }
          ],
          recap: "读完小结：1~2 句。",
          quiz: [
            { q: "问题？", options: ["选项A", "选项B", "选项C", "选项D"], a: 0, explain: "答案解析" }
          ]
        }
      ]
    }
  ],
  glossary: [                          // 词典
    { name: "词条", type: "概念", def: "解释" }
  ],
  themes: [                            // 核心主题
    { name: "主题", def: "解释" }
  ]
};

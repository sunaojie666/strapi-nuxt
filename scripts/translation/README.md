# 官网本地化规则

这个目录只保存翻译/本地化自动化所需的规则和脚本。规则与执行程序分离，方便先由运营或母语审校人员修改规则，再批量运行。

## 目录

- `config/locales.json`：语言代码、目标市场与页面方向。
- `rules/content-types.json`：营销页、UI、FAQ、技术文档和法律内容的共通要求。
- `rules/locale-profiles.json`：每种语言的母语官网写作风格、用词偏好、禁用倾向与审校重点。
- `rules/locale-experience.json`：每种语言的语法结构、礼貌程度、信息组织、UI/CTA 习惯和用户体验检查点。
- `collect-locale-references.mjs`：从你指定的目标市场官网采集公开标题、Meta 描述和 CTA 样本，只用于观察写法。
- `create-localization-prompt.mjs`：将上述规则与一个完整内容模块组合成模型提示词；它不调用 API、不写数据库。

## 使用方式

翻译链路固定如下：

```text
zh-CN factual source -> approved en master -> every other target locale
```

中文只翻译为英文；日文、德文、繁中及其他所有目标语言必须以审核通过的英文母稿为源，不得直接以中文翻译。英文母稿既是后续语言的内容源，也是术语、产品事实和页面结构的基准。

先准备一个完整的中文内容模块 JSON，例如 `input/home-hero.zh-CN.json`：

```json
{
  "title": "手机绿幕特效与投屏技术",
  "subtitle": "让直播画面更专业",
  "primaryCta": "立即下载"
}
```

先生成英文营销页的提示词：

```powershell
node scripts/translation/create-localization-prompt.mjs --locale=en --content-type=marketing --input=input/home-hero.zh-CN.json
```

英文经过翻译、结构校验和人工抽检后，将审核通过的结果保存为 `input/home-hero.en.json`。再生成日文、德文等语言的提示词：

```powershell
node scripts/translation/create-localization-prompt.mjs --locale=ja --content-type=marketing --input=input/home-hero.en.json
node scripts/translation/create-localization-prompt.mjs --locale=de --content-type=marketing --input=input/home-hero.en.json
```

在生成下游语言前，必须先对英文执行校验并创建审批记录。提示词生成器会验证该记录及英文文件的哈希值：

```powershell
node scripts/translation/validate-localization.mjs --source=input/home-hero.zh-CN.json --candidate=input/home-hero.en.json --locale=en --content-type=marketing --output=reports/home-hero.en.validation.json
node scripts/translation/review-manifest.mjs --source=input/home-hero.zh-CN.json --translation=input/home-hero.en.json --locale=en --content-type=marketing --status=approved --score=95 --reviewer=editor-name
node scripts/translation/create-localization-prompt.mjs --locale=ja --source-locale=en --content-type=marketing --input=input/home-hero.en.json --english-manifest=scripts/translation/work/manifest-id.en.manifest.json
```

输出可直接作为任意大模型 API 的 `user` 消息。生成器会根据目标语言强制判断来源：目标是 `en` 时来源必须为 `zh-CN`；其他语言来源必须为已批准且哈希匹配的 `en` 母稿。后续正式执行脚本应复用此工具生成的规则，而不是在代码中硬编码每种语言的提示词。

## 规则原则

1. 中文 `zh-CN` 是事实源，只用于生成英文母稿。
2. 英文 `en` 是其他 22 个目标语言的唯一翻译源，且必须先通过审校。
3. 以完整页面区块、卡片组或 FAQ 模块为最小翻译单元，禁止逐句或逐中文片段翻译。
4. 产品事实、数字、日期、货币、URL、字段键、变量（例如 `{count}`）和品牌/术语必须保持准确。
5. 不得新增、删除、弱化、扩大、缩小或替换功能、使用场景、目标用户、保证、比较、条件、限制或商业承诺；中文含义不明确时必须保留原有不明确性，不能为营销效果擅自补充。
6. 标题、CTA 和营销表达允许重写，以符合目标市场习惯；这属于本地化，不是逐字翻译，但绝不改变中文的业务含义。
7. 同类英文官网只用于学习句式节奏、页面层级、CTA 习惯和术语模式；不能作为产品事实来源，也不能复制其文案。
8. `legal` 内容不允许自由改写，产出只能作为人工/法律审校的草稿。
9. 所有目标语言都应经过独立审校；首页、价格、支付、账户删除、订阅与法律页必须人工抽检。

## 下游语言风格采集

每个下游语言都要单独收集目标市场的同类官网样本，不能把英文句式直接套用到其他语言：

```powershell
node scripts/translation/collect-locale-references.mjs --locale=ja --urls=https://example.jp,https://example.jp/help
```

采集结果保存在 `references/collected/ja.json`，会自动注入日文翻译提示词和审校提示词。采集内容只包括公开页面的标题、Meta 描述和 CTA，用来观察语法节奏、信息密度、按钮习惯和用户体验；不能复制参考站点的事实或文案。

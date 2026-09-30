# Shirabe（しらべ）— ブラウザーで動く統計ソフト

公開ページ.
https://k518-2026.github.io/Shirabe/

インストール不要、アカウント登録不要。ブラウザーでページを開くだけで使える統計解析ソフトです。
JASP のような「左でデータと変数を選ぶ → 右に APA 形式の表と図がすぐ出る」操作感を目指しています。

- 計算はすべてブラウザーの中で行われ、データがサーバーに送られることはありません。
- 設定を変えると結果がすぐに計算し直されます。
- 表は「コピー」ボタンで Word・Excel に罫線つきのまま貼り付けられます。図は SVG で保存できます。
- 統計の計算はどれも完璧ではありません。大事な分析では、R・JASP などほかのソフトでも結果を確かめてください。

## できること

| メニュー | 分析 | 主なオプション |
|---|---|---|
| 記述統計 | 記述統計 | 平均・中央値・最頻値・標準偏差・分散・標準誤差・四分位数・信頼区間・歪度・尖度・Shapiro-Wilk 検定、グループ別、度数分布表、ヒストグラム・箱ひげ図・棒グラフ |
| t 検定 | 1サンプルの t 検定 | Wilcoxon の符号付き順位検定、片側検定、Cohen の d、平均値の差の信頼区間、正規性の検定 |
| | 独立したサンプルの t 検定 | Student / Welch、Mann-Whitney の U 検定、Levene 検定、効果量（d・順位双列相関）、平均値の図 |
| | 対応のあるサンプルの t 検定 | Wilcoxon の符号付き順位検定、dz、差の正規性の検定 |
| 分散分析 | 分散分析（被験者間, 1〜2要因） | 平方和 Type III、η²・偏 η²・ω²、Levene 検定、Welch の分散分析、Kruskal-Wallis 検定、事後検定（Tukey / Bonferroni / Holm、推定周辺平均による比較）、平均値の図 |
| | 反復測定の分散分析（1要因） | Mauchly の球面性検定、Greenhouse-Geisser / Huynh-Feldt の補正、Friedman 検定、事後検定（Holm / Bonferroni） |
| 相関・回帰 | 相関 | Pearson・Spearman・Kendall（τb）、相関行列またはペア一覧、信頼区間、有意の印、散布図 |
| | 線形回帰 | 量的・カテゴリの説明変数、B・SE・β・信頼区間、R²・調整済み R²、分散分析表、VIF、Durbin-Watson、残差の図 |
| 度数 | 分割表（クロス集計） | 期待度数・行 %・列 %・調整済み残差、χ² 検定（連続性の補正）、尤度比 G²、Fisher の正確検定、φ・Cramér の V・オッズ比 |
| | 二項検定 | 片側検定、Clopper-Pearson の信頼区間 |
| 尺度 | 信頼性分析 | Cronbach の α、標準化 α、逆転項目、項目－残余相関、項目を除いた α |

## 使い方

1. 「開く」で CSV・TSV ファイルを選ぶか、Excel などでコピーした表を「貼り付け」ます（1行目は変数名）。「サンプル」で架空の授業データを試せます。
2. データ表の見出しのアイコンをクリックすると、尺度（📏 連続・📶 順序・🏷 名義）を切り替えられます。
3. 上のメニューから分析を選び、変数をダブルクリック・ドラッグ・「→」ボタンで欄に入れます。
4. 右側に結果が出ます。「結果を保存」で HTML に、「印刷」で PDF にできます。

- 文字コードは UTF-8 と Shift_JIS に対応しています。Excel ファイル（.xlsx）は直接は読めないので、CSV で保存するか表をコピーして貼り付けてください。
- 欠損値は空欄・`NA`・`.` などで表します。分析ごとに、使う変数のどれかが欠けている行を除きます（相関はペアごと）。
- ネットに置かずに使う場合は、リポジトリをダウンロードして `index.html` をブラウザーで開けば動きます。

## 計算の確かさ

統計計算（分布関数・検定・線形モデル）は外部ライブラリを使わずに JavaScript で書いています。
主な結果は Python の SciPy・statsmodels と突き合わせて一致を確かめました（`tests/`）。

```bash
python tests/ref_core.py core.json
node tests/verify_core.js core.json
node tests/run_analyses.js analyses.json
python tests/verify_analyses.py analyses.json
```

SciPy・statsmodels・R（JASP の計算エンジン）と結果が違う場合があるのは、主に次の点です。

- Spearman の相関の p は t 分布による近似です（R は小標本で正確な分布を使います）。
- Mann-Whitney・Wilcoxon の p は、同順位がなく n < 50 なら正確な分布、そうでなければ連続性補正つきの正規近似です（R の既定と同じ）。
- Levene 検定は平均からの偏差を使います（R の car パッケージの既定は中央値）。

## JASP との関係とライセンス

Shirabe は [JASP](https://jasp-stats.org/) を参考にした操作感を目指した、**独立したソフト**です。

- JASP は GNU Affero General Public License v3（AGPL-3.0）で公開されています。Shirabe には JASP のソースコード・R モジュール・画像・アイコン・データライブラリを**一切含めていません**。JASP のコードを読み写したり翻訳したりもしていません。統計手法は教科書・原論文の公開された式から独自に実装しています（Shapiro-Wilk 検定は Royston (1992, 1995) の近似式、スチューデント化された範囲の分布は数値積分など）。
- そのため Shirabe は JASP の派生物ではなく、AGPL の条件は及びません。Shirabe 自体は MIT License です（`LICENSE.txt`）。
- 「JASP」はアムステルダム大学の商標です。Shirabe は JASP チーム・アムステルダム大学とは関係がなく、承認も受けていません。名称・ロゴに JASP を使っていないのはこのためです。
- サンプルデータは `scripts/make_sample.js` で乱数から作った架空のデータです。

## ファイル構成

| パス | 内容 |
|---|---|
| `index.html` | 画面 |
| `css/style.css` | スタイル（ライト・ダーク両対応） |
| `js/stats.js` | 分布関数・検定・行列・最小二乗法 |
| `js/data.js` | CSV の読み込みと変数の尺度 |
| `js/analyses.js` | 各分析の設定項目と計算・出力 |
| `js/plots.js` | 図（SVG） |
| `js/app.js` | 画面の動き |
| `samples/` | サンプルデータ（`scripts/make_sample.js` で生成） |
| `tests/` | SciPy・statsmodels との照合 |

## ライセンス

MIT License — Copyright (c) 2026 K.Yamamoto

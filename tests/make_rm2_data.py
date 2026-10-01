# 2要因の反復測定（被験者内 2×3）の照合用データを作る（架空・乱数の種を固定）
# 使い方: python tests/make_rm2_data.py → tests/rm2_data.csv
from pathlib import Path
import numpy as np

rng = np.random.default_rng(20261001)
n = 32
subj = rng.normal(0, 6, n)
eff_a = np.array([0.0, 3.0])
eff_b = np.array([0.0, 1.5, 4.0])
inter = np.array([[0, 0, 0], [0, 1.0, -2.0]])
rows = ["番号,群,A1B1,A1B2,A1B3,A2B1,A2B2,A2B3"]
for i in range(n):
    vals = []
    for a in range(2):
        for b in range(3):
            # 被験者ごとに条件で効き方が違うようにして、球面性を崩しておく
            vals.append(50 + subj[i] + eff_a[a] + eff_b[b] + inter[a, b] + rng.normal(0, 3 + 1.5 * b))
    g = "甲" if i % 3 else "乙"
    vals = [f"{v:.1f}" for v in vals]
    if i == 7: vals[4] = "NA"
    rows.append(",".join([str(i + 1), g] + vals))
(Path(__file__).parent / "rm2_data.csv").write_text("\n".join(rows) + "\n", encoding="utf-8")
print(f"{n} 行を書き出しました")

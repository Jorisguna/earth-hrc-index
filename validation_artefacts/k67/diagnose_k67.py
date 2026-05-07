"""
diagnose_k67.py — pre-build validation diagnostic for K67 / BR-Sa1.

Run this against the AmeriFlux FLUXNET HH file before running analyse_k67.py
to confirm:
  - Variable distributions are physically sensible
  - LE_F_MDS_QC has expected discrete values
  - NIGHT column is populated as 0/1
  - LE_CORR is null across the entire file (the K67-specific gotcha)
  - Strict mask sample size is adequate

Output is purely diagnostic — no CSVs written. Run before analyse_k67.py.
"""
import pandas as pd

fname = 'AMF_BR-Sa1_FLUXNET_FLUXMET_HH_2002-2011_v1.3_r1.csv'

print(f'Reading {fname} ...')

df = pd.read_csv(
    fname,
    usecols=['TIMESTAMP_START', 'LE_F_MDS', 'LE_F_MDS_QC', 'LE_CORR',
             'NETRAD', 'SW_IN_F_MDS', 'NIGHT'],
    na_values=[-9999, '-9999']
)
print(f'Loaded {len(df):,} rows')
print()

print('=== TIMESTAMP range ===')
print(f'Earliest: {df["TIMESTAMP_START"].min()}')
print(f'Latest:   {df["TIMESTAMP_START"].max()}')
print()

print('=== Null counts per column ===')
print(df.isna().sum())
print()

print('=== LE_F_MDS_QC distribution ===')
print(df['LE_F_MDS_QC'].value_counts(dropna=False).sort_index().head(20))
print('LE_F_MDS_QC dtype:', df['LE_F_MDS_QC'].dtype)
print('LE_F_MDS_QC describe:')
print(df['LE_F_MDS_QC'].describe())
print()

print('=== NIGHT column distribution ===')
print(df['NIGHT'].value_counts(dropna=False).sort_index())
print('NIGHT dtype:', df['NIGHT'].dtype)
print()

print('=== SW_IN_F_MDS distribution ===')
print(df['SW_IN_F_MDS'].describe())
print(f'Rows with SW_IN > 50:  {(df["SW_IN_F_MDS"] > 50).sum()}')
print(f'Rows with SW_IN > 100: {(df["SW_IN_F_MDS"] > 100).sum()}')
print(f'Rows with SW_IN > 200: {(df["SW_IN_F_MDS"] > 200).sum()}')
print()

print('=== LE_F_MDS distribution ===')
print(df['LE_F_MDS'].describe())
print()

print('=== LE_CORR distribution ===')
print(df['LE_CORR'].describe())
print(f'LE_CORR null count: {df["LE_CORR"].isna().sum()} of {len(df)}')
print(f'LE_CORR all null? {df["LE_CORR"].isna().all()}')
print()

print('=== NETRAD distribution ===')
print(df['NETRAD'].describe())
print(f'NETRAD null count: {df["NETRAD"].isna().sum()} of {len(df)}')
print(f'NETRAD > 0 count: {(df["NETRAD"] > 0).sum()}')
print(f'NETRAD > 100 count: {(df["NETRAD"] > 100).sum()}')
print()

print('=== Mask construction step-by-step ===')
print(f'Total rows:                                       {len(df)}')
print(f'After SW_IN_F_MDS > 200:                          {(df["SW_IN_F_MDS"] > 200).sum()}')
print(f'After SW_IN > 200 AND LE_F_MDS_QC == 0:           {((df["SW_IN_F_MDS"] > 200) & (df["LE_F_MDS_QC"] == 0)).sum()}')
print(f'After SW_IN > 200 AND LE_F_MDS_QC == 0 AND NETRAD > 100: {((df["SW_IN_F_MDS"] > 200) & (df["LE_F_MDS_QC"] == 0) & (df["NETRAD"] > 100)).sum()}')

# Same chain but adding LE_CORR not-null condition
m = ((df["SW_IN_F_MDS"] > 200) &
     (df["LE_F_MDS_QC"] == 0) &
     (df["NETRAD"] > 100) &
     (df["NETRAD"] < 1200) &
     df["LE_F_MDS"].notna() &
     df["NETRAD"].notna() &
     df["LE_CORR"].notna())
print(f'Full strict mask:                                 {m.sum()}')

print()
print('=== First 5 daytime rows (any quality) ===')
sample = df[df['SW_IN_F_MDS'] > 200].head(5)
print(sample.to_string(index=False))

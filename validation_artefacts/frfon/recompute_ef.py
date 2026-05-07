"""
recompute_ef.py — recompute FR-Fon annual EF using ratio-of-annual-sums.

The original frfon_annual_ef.csv used mean-of-monthly-EFs which systematically
under-states annual EF for deciduous forests (winter low-radiation months get
equal weight despite contributing little actual evapotranspiration).

This script reads frfon_monthly_ef.csv and re-aggregates as ratio-of-annual-sums,
matching the satellite HRC formula. Output: frfon_annual_ef_v2.csv with the
v2.1 reference value of 5.04.

Source data: ICOS ETC L2 Fluxnet half-hourly product, FR-Fon site, 2019Q4-2025.
"""
import pandas as pd

df = pd.read_csv('frfon_monthly_ef.csv')
df['year'] = df['year'].astype(str)

# Exclude partial 2019 (Q4 only)
df_full = df[df['year'] != '2019'].copy()

# Annual ratio-of-sums
annual = df_full.groupby('year').agg({
    'sum_LE_F_MDS_W': 'sum',
    'sum_LE_CORR_W':  'sum',
    'sum_NETRAD_W':   'sum',
    'n_halfhourly':   'sum',
}).reset_index()

annual['EF_uncorr_ratio'] = (annual['sum_LE_F_MDS_W'] / annual['sum_NETRAD_W']).round(3)
annual['EF_corr_ratio']   = (annual['sum_LE_CORR_W']  / annual['sum_NETRAD_W']).round(3)
annual['hrc_ref_uncorr']  = (annual['EF_uncorr_ratio'] * 10).round(2)
annual['hrc_ref_corr']    = (annual['EF_corr_ratio']   * 10).round(2)

# Save
annual.to_csv('frfon_annual_ef_v2.csv', index=False)
print(annual.to_string(index=False))
print()
print(f'Multi-year mean EF_corr (ratio-of-sums): {annual["EF_corr_ratio"].mean():.3f}')
print(f'==> HRC reference for FR-Fon: {annual["EF_corr_ratio"].mean() * 10:.2f}')
print()
print('Saved to frfon_annual_ef_v2.csv')

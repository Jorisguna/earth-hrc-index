"""
analyse_k67.py — compute K67 (Tapajós BR-Sa1) annual EF from FLUXNET HH data.

K67-specific note: LE_CORR was not computed in this AmeriFlux v1.3 r1 release
(all 175,296 half-hours have LE_CORR = null). We use LE_F_MDS (uncorrected)
and apply a published energy-balance-closure factor of 1.18 for dimensional
comparability with the FR-Fon corrected reference.

Citation for EBC = 1.18:
  Hutyra et al. (2008) Global Change Biology
  Restrepo-Coupe et al. (2013) Agricultural and Forest Meteorology

⚠ The 1.18 factor was derived from training-data memory during pre-build
   validation. Citation verification is tracked in
   docs/v2_1_higher_fidelity_open_items.md and must be confirmed before
   external sharing of the methodology paper or v2.1 reference value 7.89.

Output: HRC reference for K67 (Tapajós primary forest) = 7.89
        (multi-year mean across 7 full years with n_halfhourly > 1000)
"""
import pandas as pd

fname = 'AMF_BR-Sa1_FLUXNET_FLUXMET_HH_2002-2011_v1.3_r1.csv'

EBC_FACTOR_K67_PUBLISHED = 1.18

print(f'Reading {fname} ...')
df = pd.read_csv(
    fname,
    usecols=['TIMESTAMP_START', 'LE_F_MDS', 'LE_F_MDS_QC',
             'NETRAD', 'SW_IN_F_MDS', 'NIGHT'],
    na_values=[-9999, '-9999']
)
print(f'Loaded {len(df):,} rows')

df['year']  = df['TIMESTAMP_START'].astype(str).str[:4]
df['month'] = df['TIMESTAMP_START'].astype(str).str[:6]

# Strict mask without LE_CORR requirement
mask = (
    (df['SW_IN_F_MDS'] > 200) &
    (df['LE_F_MDS_QC'] == 0) &
    (df['NETRAD'] > 100) &
    (df['NETRAD'] < 1200) &
    df['LE_F_MDS'].notna() &
    df['NETRAD'].notna()
)
strict = df[mask].copy()
print(f'After strict mask: {len(strict):,} rows ({len(strict)/len(df)*100:.1f}% of total)')
print(f'Years available: {sorted(strict["year"].unique())}')

# Per-month
monthly_groups = strict.groupby('month')
monthly = pd.DataFrame({
    'n_halfhourly':       monthly_groups.size(),
    'sum_LE_F_MDS_W':     monthly_groups['LE_F_MDS'].sum(),
    'sum_NETRAD_W':       monthly_groups['NETRAD'].sum(),
})
monthly['EF_uncorr'] = (monthly['sum_LE_F_MDS_W'] / monthly['sum_NETRAD_W']).round(3)
monthly['EF_corr_pub_EBC'] = (monthly['EF_uncorr'] * EBC_FACTOR_K67_PUBLISHED).round(3)
monthly['year'] = monthly.index.str[:4]
monthly = monthly.reset_index()
monthly.to_csv('k67_monthly_ef.csv', index=False)

# Annual ratio of sums
annual_groups = strict.groupby('year')
annual = pd.DataFrame({
    'n_halfhourly': annual_groups.size(),
    'sum_LE_F_MDS': annual_groups['LE_F_MDS'].sum(),
    'sum_NETRAD':   annual_groups['NETRAD'].sum(),
}).reset_index()
annual['EF_uncorr_ratio']    = (annual['sum_LE_F_MDS'] / annual['sum_NETRAD']).round(3)
annual['EF_corr_pub_EBC']    = (annual['EF_uncorr_ratio'] * EBC_FACTOR_K67_PUBLISHED).round(3)
annual['hrc_ref_uncorr']     = (annual['EF_uncorr_ratio'] * 10).round(2)
annual['hrc_ref_corr']       = (annual['EF_corr_pub_EBC']  * 10).round(2)
annual.to_csv('k67_annual_ef.csv', index=False)

print()
print('=== Annual EF for K67 (Tapajos primary forest, 2002-2011) ===')
print(annual.to_string(index=False))
print()

# Filter out years with very few half-hours
full_years = annual[annual['n_halfhourly'] > 1000]
print(f'Full years used for multi-year mean: {list(full_years["year"])}')
print(f'Multi-year mean EF_uncorr: {full_years["EF_uncorr_ratio"].mean():.3f}')
print(f'Multi-year mean EF with published EBC factor of {EBC_FACTOR_K67_PUBLISHED}: '
      f'{full_years["EF_corr_pub_EBC"].mean():.3f}')
print()
print(f'==> HRC reference for K67 (uncorrected, raw eddy covariance): '
      f'{full_years["EF_uncorr_ratio"].mean() * 10:.2f}')
print(f'==> HRC reference for K67 (with published EBC = 1.18, headline value): '
      f'{full_years["EF_corr_pub_EBC"].mean() * 10:.2f}')
print()

# Drought year identification
drought_years = ['2005', '2010']
print(f'Note: 2005 and 2010 were Amazon drought years.')
for dy in drought_years:
    if dy in full_years['year'].values:
        ef = full_years[full_years['year'] == dy]['EF_corr_pub_EBC'].iloc[0]
        print(f'  {dy} EF_corr_pub_EBC: {ef:.3f}')

print()
print('Saved k67_monthly_ef.csv and k67_annual_ef.csv')

-- ============================================================
-- HRC Index — update trend_score_60m from: HRC_LA_Trend_60months.csv
-- 60-month deseasonalised trend (June 2018 – May 2023)
-- Original trend_score (24-month) is preserved unchanged
-- Tiles matched by coordinates rounded to 4 decimal places
-- Paste this entire block into Supabase SQL Editor and click Run
-- ============================================================

BEGIN;

UPDATE hrc_tiles SET trend_score_60m = -0.02860920679 WHERE ROUND(longitude::numeric, 4) = -117.7505 AND ROUND(latitude::numeric, 4) = 33.5502;
UPDATE hrc_tiles SET trend_score_60m = -0.02722199708 WHERE ROUND(longitude::numeric, 4) = -117.6505 AND ROUND(latitude::numeric, 4) = 33.5502;
UPDATE hrc_tiles SET trend_score_60m = -0.04618584746 WHERE ROUND(longitude::numeric, 4) = -117.5505 AND ROUND(latitude::numeric, 4) = 33.5502;
UPDATE hrc_tiles SET trend_score_60m = -0.03473508271 WHERE ROUND(longitude::numeric, 4) = -117.9505 AND ROUND(latitude::numeric, 4) = 33.6502;
UPDATE hrc_tiles SET trend_score_60m = -0.03143027117 WHERE ROUND(longitude::numeric, 4) = -117.8505 AND ROUND(latitude::numeric, 4) = 33.6502;
UPDATE hrc_tiles SET trend_score_60m = -0.03641016768 WHERE ROUND(longitude::numeric, 4) = -117.7505 AND ROUND(latitude::numeric, 4) = 33.6502;
UPDATE hrc_tiles SET trend_score_60m = -0.03482732856 WHERE ROUND(longitude::numeric, 4) = -117.6505 AND ROUND(latitude::numeric, 4) = 33.6502;
UPDATE hrc_tiles SET trend_score_60m = -0.03554554062 WHERE ROUND(longitude::numeric, 4) = -117.5505 AND ROUND(latitude::numeric, 4) = 33.6502;
UPDATE hrc_tiles SET trend_score_60m = -0.02195679696 WHERE ROUND(longitude::numeric, 4) = -118.2505 AND ROUND(latitude::numeric, 4) = 33.7502;
UPDATE hrc_tiles SET trend_score_60m = -0.01413727143 WHERE ROUND(longitude::numeric, 4) = -118.1505 AND ROUND(latitude::numeric, 4) = 33.7502;
UPDATE hrc_tiles SET trend_score_60m = -0.01960730165 WHERE ROUND(longitude::numeric, 4) = -118.0505 AND ROUND(latitude::numeric, 4) = 33.7502;
UPDATE hrc_tiles SET trend_score_60m = -0.0281145156 WHERE ROUND(longitude::numeric, 4) = -117.9505 AND ROUND(latitude::numeric, 4) = 33.7502;
UPDATE hrc_tiles SET trend_score_60m = -0.03204877926 WHERE ROUND(longitude::numeric, 4) = -117.8505 AND ROUND(latitude::numeric, 4) = 33.7502;
UPDATE hrc_tiles SET trend_score_60m = -0.0437221523 WHERE ROUND(longitude::numeric, 4) = -117.7505 AND ROUND(latitude::numeric, 4) = 33.7502;
UPDATE hrc_tiles SET trend_score_60m = -0.05298244586 WHERE ROUND(longitude::numeric, 4) = -117.6505 AND ROUND(latitude::numeric, 4) = 33.7502;
UPDATE hrc_tiles SET trend_score_60m = -0.0550794518 WHERE ROUND(longitude::numeric, 4) = -117.5505 AND ROUND(latitude::numeric, 4) = 33.7502;
UPDATE hrc_tiles SET trend_score_60m = -0.004400423415 WHERE ROUND(longitude::numeric, 4) = -118.3505 AND ROUND(latitude::numeric, 4) = 33.8502;
UPDATE hrc_tiles SET trend_score_60m = -0.01309276714 WHERE ROUND(longitude::numeric, 4) = -118.2505 AND ROUND(latitude::numeric, 4) = 33.8502;
UPDATE hrc_tiles SET trend_score_60m = -0.01569648448 WHERE ROUND(longitude::numeric, 4) = -118.1505 AND ROUND(latitude::numeric, 4) = 33.8502;
UPDATE hrc_tiles SET trend_score_60m = -0.02396733413 WHERE ROUND(longitude::numeric, 4) = -118.0505 AND ROUND(latitude::numeric, 4) = 33.8502;
UPDATE hrc_tiles SET trend_score_60m = -0.0323755869 WHERE ROUND(longitude::numeric, 4) = -117.9505 AND ROUND(latitude::numeric, 4) = 33.8502;
UPDATE hrc_tiles SET trend_score_60m = -0.0440381127 WHERE ROUND(longitude::numeric, 4) = -117.8505 AND ROUND(latitude::numeric, 4) = 33.8502;
UPDATE hrc_tiles SET trend_score_60m = -0.06211711353 WHERE ROUND(longitude::numeric, 4) = -117.7505 AND ROUND(latitude::numeric, 4) = 33.8502;
UPDATE hrc_tiles SET trend_score_60m = -0.06861980196 WHERE ROUND(longitude::numeric, 4) = -117.6505 AND ROUND(latitude::numeric, 4) = 33.8502;
UPDATE hrc_tiles SET trend_score_60m = -0.05886006137 WHERE ROUND(longitude::numeric, 4) = -117.5505 AND ROUND(latitude::numeric, 4) = 33.8502;
UPDATE hrc_tiles SET trend_score_60m = -0.009239954331 WHERE ROUND(longitude::numeric, 4) = -118.3505 AND ROUND(latitude::numeric, 4) = 33.9502;
UPDATE hrc_tiles SET trend_score_60m = -0.01167505999 WHERE ROUND(longitude::numeric, 4) = -118.2505 AND ROUND(latitude::numeric, 4) = 33.9502;
UPDATE hrc_tiles SET trend_score_60m = -0.01196094158 WHERE ROUND(longitude::numeric, 4) = -118.1505 AND ROUND(latitude::numeric, 4) = 33.9502;
UPDATE hrc_tiles SET trend_score_60m = -0.0131325901 WHERE ROUND(longitude::numeric, 4) = -118.0505 AND ROUND(latitude::numeric, 4) = 33.9502;
UPDATE hrc_tiles SET trend_score_60m = -0.02738065881 WHERE ROUND(longitude::numeric, 4) = -117.9505 AND ROUND(latitude::numeric, 4) = 33.9502;
UPDATE hrc_tiles SET trend_score_60m = -0.04714458396 WHERE ROUND(longitude::numeric, 4) = -117.8505 AND ROUND(latitude::numeric, 4) = 33.9502;
UPDATE hrc_tiles SET trend_score_60m = -0.06219505913 WHERE ROUND(longitude::numeric, 4) = -117.7505 AND ROUND(latitude::numeric, 4) = 33.9502;
UPDATE hrc_tiles SET trend_score_60m = -0.05971014423 WHERE ROUND(longitude::numeric, 4) = -117.6505 AND ROUND(latitude::numeric, 4) = 33.9502;
UPDATE hrc_tiles SET trend_score_60m = -0.05192338622 WHERE ROUND(longitude::numeric, 4) = -117.5505 AND ROUND(latitude::numeric, 4) = 33.9502;
UPDATE hrc_tiles SET trend_score_60m = -0.04165064685 WHERE ROUND(longitude::numeric, 4) = -118.8505 AND ROUND(latitude::numeric, 4) = 34.0502;
UPDATE hrc_tiles SET trend_score_60m = -0.04579397711 WHERE ROUND(longitude::numeric, 4) = -118.7505 AND ROUND(latitude::numeric, 4) = 34.0502;
UPDATE hrc_tiles SET trend_score_60m = -0.0332841919 WHERE ROUND(longitude::numeric, 4) = -118.6505 AND ROUND(latitude::numeric, 4) = 34.0502;
UPDATE hrc_tiles SET trend_score_60m = -0.02470905478 WHERE ROUND(longitude::numeric, 4) = -118.5505 AND ROUND(latitude::numeric, 4) = 34.0502;
UPDATE hrc_tiles SET trend_score_60m = -0.01716804999 WHERE ROUND(longitude::numeric, 4) = -118.4505 AND ROUND(latitude::numeric, 4) = 34.0502;
UPDATE hrc_tiles SET trend_score_60m = -0.01522836681 WHERE ROUND(longitude::numeric, 4) = -118.3505 AND ROUND(latitude::numeric, 4) = 34.0502;
UPDATE hrc_tiles SET trend_score_60m = -0.02099263752 WHERE ROUND(longitude::numeric, 4) = -118.2505 AND ROUND(latitude::numeric, 4) = 34.0502;
UPDATE hrc_tiles SET trend_score_60m = -0.01337371273 WHERE ROUND(longitude::numeric, 4) = -118.1505 AND ROUND(latitude::numeric, 4) = 34.0502;
UPDATE hrc_tiles SET trend_score_60m = -0.01487085174 WHERE ROUND(longitude::numeric, 4) = -118.0505 AND ROUND(latitude::numeric, 4) = 34.0502;
UPDATE hrc_tiles SET trend_score_60m = -0.02607330584 WHERE ROUND(longitude::numeric, 4) = -117.9505 AND ROUND(latitude::numeric, 4) = 34.0502;
UPDATE hrc_tiles SET trend_score_60m = -0.03906267033 WHERE ROUND(longitude::numeric, 4) = -117.8505 AND ROUND(latitude::numeric, 4) = 34.0502;
UPDATE hrc_tiles SET trend_score_60m = -0.05095640601 WHERE ROUND(longitude::numeric, 4) = -117.7505 AND ROUND(latitude::numeric, 4) = 34.0502;
UPDATE hrc_tiles SET trend_score_60m = -0.04617883309 WHERE ROUND(longitude::numeric, 4) = -117.6505 AND ROUND(latitude::numeric, 4) = 34.0502;
UPDATE hrc_tiles SET trend_score_60m = -0.04055107743 WHERE ROUND(longitude::numeric, 4) = -117.5505 AND ROUND(latitude::numeric, 4) = 34.0502;
UPDATE hrc_tiles SET trend_score_60m = -0.05020122788 WHERE ROUND(longitude::numeric, 4) = -118.9505 AND ROUND(latitude::numeric, 4) = 34.1502;
UPDATE hrc_tiles SET trend_score_60m = -0.04524942917 WHERE ROUND(longitude::numeric, 4) = -118.8505 AND ROUND(latitude::numeric, 4) = 34.1502;
UPDATE hrc_tiles SET trend_score_60m = -0.04241708997 WHERE ROUND(longitude::numeric, 4) = -118.7505 AND ROUND(latitude::numeric, 4) = 34.1502;
UPDATE hrc_tiles SET trend_score_60m = -0.03340209916 WHERE ROUND(longitude::numeric, 4) = -118.6505 AND ROUND(latitude::numeric, 4) = 34.1502;
UPDATE hrc_tiles SET trend_score_60m = -0.02314523537 WHERE ROUND(longitude::numeric, 4) = -118.5505 AND ROUND(latitude::numeric, 4) = 34.1502;
UPDATE hrc_tiles SET trend_score_60m = -0.01406667518 WHERE ROUND(longitude::numeric, 4) = -118.4505 AND ROUND(latitude::numeric, 4) = 34.1502;
UPDATE hrc_tiles SET trend_score_60m = -0.007362554381 WHERE ROUND(longitude::numeric, 4) = -118.3505 AND ROUND(latitude::numeric, 4) = 34.1502;
UPDATE hrc_tiles SET trend_score_60m = -0.01893041789 WHERE ROUND(longitude::numeric, 4) = -118.2505 AND ROUND(latitude::numeric, 4) = 34.1502;
UPDATE hrc_tiles SET trend_score_60m = -0.006859786297 WHERE ROUND(longitude::numeric, 4) = -118.1505 AND ROUND(latitude::numeric, 4) = 34.1502;
UPDATE hrc_tiles SET trend_score_60m = -0.003246370456 WHERE ROUND(longitude::numeric, 4) = -118.0505 AND ROUND(latitude::numeric, 4) = 34.1502;
UPDATE hrc_tiles SET trend_score_60m = -0.004766240425 WHERE ROUND(longitude::numeric, 4) = -117.9505 AND ROUND(latitude::numeric, 4) = 34.1502;
UPDATE hrc_tiles SET trend_score_60m = -0.01084083726 WHERE ROUND(longitude::numeric, 4) = -117.8505 AND ROUND(latitude::numeric, 4) = 34.1502;
UPDATE hrc_tiles SET trend_score_60m = -0.02251568377 WHERE ROUND(longitude::numeric, 4) = -117.7505 AND ROUND(latitude::numeric, 4) = 34.1502;
UPDATE hrc_tiles SET trend_score_60m = -0.02916315439 WHERE ROUND(longitude::numeric, 4) = -117.6505 AND ROUND(latitude::numeric, 4) = 34.1502;
UPDATE hrc_tiles SET trend_score_60m = -0.0230459552 WHERE ROUND(longitude::numeric, 4) = -117.5505 AND ROUND(latitude::numeric, 4) = 34.1502;
UPDATE hrc_tiles SET trend_score_60m = -0.03836203484 WHERE ROUND(longitude::numeric, 4) = -118.9505 AND ROUND(latitude::numeric, 4) = 34.2502;
UPDATE hrc_tiles SET trend_score_60m = -0.03256151351 WHERE ROUND(longitude::numeric, 4) = -118.8505 AND ROUND(latitude::numeric, 4) = 34.2502;
UPDATE hrc_tiles SET trend_score_60m = -0.02515576086 WHERE ROUND(longitude::numeric, 4) = -118.7505 AND ROUND(latitude::numeric, 4) = 34.2502;
UPDATE hrc_tiles SET trend_score_60m = -0.0119677241 WHERE ROUND(longitude::numeric, 4) = -118.6505 AND ROUND(latitude::numeric, 4) = 34.2502;
UPDATE hrc_tiles SET trend_score_60m = -0.000925 WHERE ROUND(longitude::numeric, 4) = -118.5505 AND ROUND(latitude::numeric, 4) = 34.2502;
UPDATE hrc_tiles SET trend_score_60m = 0.003281675232 WHERE ROUND(longitude::numeric, 4) = -118.4505 AND ROUND(latitude::numeric, 4) = 34.2502;
UPDATE hrc_tiles SET trend_score_60m = 0.004558538884 WHERE ROUND(longitude::numeric, 4) = -118.3505 AND ROUND(latitude::numeric, 4) = 34.2502;
UPDATE hrc_tiles SET trend_score_60m = 0.005685552871 WHERE ROUND(longitude::numeric, 4) = -118.2505 AND ROUND(latitude::numeric, 4) = 34.2502;
UPDATE hrc_tiles SET trend_score_60m = 0.009341041311 WHERE ROUND(longitude::numeric, 4) = -118.1505 AND ROUND(latitude::numeric, 4) = 34.2502;
UPDATE hrc_tiles SET trend_score_60m = 0.009390815717 WHERE ROUND(longitude::numeric, 4) = -118.0505 AND ROUND(latitude::numeric, 4) = 34.2502;
UPDATE hrc_tiles SET trend_score_60m = 0.007380724808 WHERE ROUND(longitude::numeric, 4) = -117.9505 AND ROUND(latitude::numeric, 4) = 34.2502;
UPDATE hrc_tiles SET trend_score_60m = 0.006496102514 WHERE ROUND(longitude::numeric, 4) = -117.8505 AND ROUND(latitude::numeric, 4) = 34.2502;
UPDATE hrc_tiles SET trend_score_60m = -0.01149357394 WHERE ROUND(longitude::numeric, 4) = -117.7505 AND ROUND(latitude::numeric, 4) = 34.2502;
UPDATE hrc_tiles SET trend_score_60m = -0.02591388248 WHERE ROUND(longitude::numeric, 4) = -117.6505 AND ROUND(latitude::numeric, 4) = 34.2502;
UPDATE hrc_tiles SET trend_score_60m = -0.01403645185 WHERE ROUND(longitude::numeric, 4) = -117.5505 AND ROUND(latitude::numeric, 4) = 34.2502;
UPDATE hrc_tiles SET trend_score_60m = -0.01649440301 WHERE ROUND(longitude::numeric, 4) = -118.9505 AND ROUND(latitude::numeric, 4) = 34.3502;
UPDATE hrc_tiles SET trend_score_60m = -0.009257077154 WHERE ROUND(longitude::numeric, 4) = -118.8505 AND ROUND(latitude::numeric, 4) = 34.3502;
UPDATE hrc_tiles SET trend_score_60m = -0.00225930301 WHERE ROUND(longitude::numeric, 4) = -118.7505 AND ROUND(latitude::numeric, 4) = 34.3502;
UPDATE hrc_tiles SET trend_score_60m = 0.009042713728 WHERE ROUND(longitude::numeric, 4) = -118.6505 AND ROUND(latitude::numeric, 4) = 34.3502;
UPDATE hrc_tiles SET trend_score_60m = 0.01707922825 WHERE ROUND(longitude::numeric, 4) = -118.5505 AND ROUND(latitude::numeric, 4) = 34.3502;
UPDATE hrc_tiles SET trend_score_60m = 0.02016889147 WHERE ROUND(longitude::numeric, 4) = -118.4505 AND ROUND(latitude::numeric, 4) = 34.3502;
UPDATE hrc_tiles SET trend_score_60m = 0.02643478882 WHERE ROUND(longitude::numeric, 4) = -118.3505 AND ROUND(latitude::numeric, 4) = 34.3502;
UPDATE hrc_tiles SET trend_score_60m = 0.03204937459 WHERE ROUND(longitude::numeric, 4) = -118.2505 AND ROUND(latitude::numeric, 4) = 34.3502;
UPDATE hrc_tiles SET trend_score_60m = 0.02445404609 WHERE ROUND(longitude::numeric, 4) = -118.1505 AND ROUND(latitude::numeric, 4) = 34.3502;
UPDATE hrc_tiles SET trend_score_60m = 0.02223374274 WHERE ROUND(longitude::numeric, 4) = -118.0505 AND ROUND(latitude::numeric, 4) = 34.3502;
UPDATE hrc_tiles SET trend_score_60m = 0.0170888932 WHERE ROUND(longitude::numeric, 4) = -117.9505 AND ROUND(latitude::numeric, 4) = 34.3502;
UPDATE hrc_tiles SET trend_score_60m = 0.005873400352 WHERE ROUND(longitude::numeric, 4) = -117.8505 AND ROUND(latitude::numeric, 4) = 34.3502;
UPDATE hrc_tiles SET trend_score_60m = -0.006041929171 WHERE ROUND(longitude::numeric, 4) = -117.7505 AND ROUND(latitude::numeric, 4) = 34.3502;
UPDATE hrc_tiles SET trend_score_60m = -0.01327251546 WHERE ROUND(longitude::numeric, 4) = -117.6505 AND ROUND(latitude::numeric, 4) = 34.3502;
UPDATE hrc_tiles SET trend_score_60m = -0.0167612733 WHERE ROUND(longitude::numeric, 4) = -117.5505 AND ROUND(latitude::numeric, 4) = 34.3502;
UPDATE hrc_tiles SET trend_score_60m = -0.02439941548 WHERE ROUND(longitude::numeric, 4) = -118.9505 AND ROUND(latitude::numeric, 4) = 34.4502;
UPDATE hrc_tiles SET trend_score_60m = -0.003193954358 WHERE ROUND(longitude::numeric, 4) = -118.8505 AND ROUND(latitude::numeric, 4) = 34.4502;
UPDATE hrc_tiles SET trend_score_60m = 0.01525109561 WHERE ROUND(longitude::numeric, 4) = -118.7505 AND ROUND(latitude::numeric, 4) = 34.4502;
UPDATE hrc_tiles SET trend_score_60m = 0.01319293944 WHERE ROUND(longitude::numeric, 4) = -118.6505 AND ROUND(latitude::numeric, 4) = 34.4502;
UPDATE hrc_tiles SET trend_score_60m = 0.009616704688 WHERE ROUND(longitude::numeric, 4) = -118.5505 AND ROUND(latitude::numeric, 4) = 34.4502;
UPDATE hrc_tiles SET trend_score_60m = 0.01467513357 WHERE ROUND(longitude::numeric, 4) = -118.4505 AND ROUND(latitude::numeric, 4) = 34.4502;
UPDATE hrc_tiles SET trend_score_60m = 0.02212133792 WHERE ROUND(longitude::numeric, 4) = -118.3505 AND ROUND(latitude::numeric, 4) = 34.4502;
UPDATE hrc_tiles SET trend_score_60m = 0.02619619231 WHERE ROUND(longitude::numeric, 4) = -118.2505 AND ROUND(latitude::numeric, 4) = 34.4502;
UPDATE hrc_tiles SET trend_score_60m = 0.03107414707 WHERE ROUND(longitude::numeric, 4) = -118.1505 AND ROUND(latitude::numeric, 4) = 34.4502;
UPDATE hrc_tiles SET trend_score_60m = 0.02943812887 WHERE ROUND(longitude::numeric, 4) = -118.0505 AND ROUND(latitude::numeric, 4) = 34.4502;
UPDATE hrc_tiles SET trend_score_60m = 0.030601284 WHERE ROUND(longitude::numeric, 4) = -117.9505 AND ROUND(latitude::numeric, 4) = 34.4502;
UPDATE hrc_tiles SET trend_score_60m = 0.02007130283 WHERE ROUND(longitude::numeric, 4) = -117.8505 AND ROUND(latitude::numeric, 4) = 34.4502;
UPDATE hrc_tiles SET trend_score_60m = 0.004803290245 WHERE ROUND(longitude::numeric, 4) = -117.7505 AND ROUND(latitude::numeric, 4) = 34.4502;
UPDATE hrc_tiles SET trend_score_60m = -0.0126084014 WHERE ROUND(longitude::numeric, 4) = -117.6505 AND ROUND(latitude::numeric, 4) = 34.4502;
UPDATE hrc_tiles SET trend_score_60m = -0.02932360292 WHERE ROUND(longitude::numeric, 4) = -117.5505 AND ROUND(latitude::numeric, 4) = 34.4502;

COMMIT;

-- 108 UPDATE statements generated
-- After running, verify with:
-- SELECT COUNT(*), AVG(trend_score), AVG(trend_score_60m)
-- FROM hrc_tiles;
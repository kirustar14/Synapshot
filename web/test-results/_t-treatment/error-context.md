# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: _t.spec.ts >> treatment
- Location: e2e/_t.spec.ts:3:1

# Error details

```
Error: locator.screenshot: Error: strict mode violation: locator('aside') resolved to 2 elements:
    1) <aside class="order-2 rounded-2xl border border-border/70 bg-card lg:order-1 lg:min-h-0 lg:overflow-y-auto">…</aside> aka getByRole('complementary').filter({ hasText: 'Key factsWeek9 of 12MRISmall' })
    2) <aside class="order-3 flex flex-col rounded-2xl border border-border/70 bg-card lg:min-h-0 lg:overflow-hidden">…</aside> aka getByRole('complementary').filter({ hasText: 'DataAnalysisTreatmentTimelineHypothetical what-if on a network model. Not a' })

Call log:
  - waiting for locator('aside')

```

# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e3]:
    - banner [ref=e4]:
      - link "Synapshot home" [ref=e5] [cursor=pointer]:
        - /url: /
        - generic [ref=e6]: Synapshot.
      - generic [ref=e7]:
        - generic [ref=e8]:
          - generic [ref=e11] [cursor=pointer]: Demo mode
          - switch "Run the check-in on this laptop" [ref=e12] [cursor=pointer]
        - button "Switch to dark mode" [ref=e13] [cursor=pointer]
    - generic [ref=e14]:
      - banner [ref=e15]:
        - generic [ref=e16]:
          - heading "Maya Ortiz" [level=1] [ref=e18]
          - paragraph [ref=e19]: 22, female, college soccer midfielder
        - generic [ref=e20]:
          - generic "head-to-head collision contesting an aerial ball during a college soccer match" [ref=e21]:
            - paragraph [ref=e22]: Injury
            - paragraph [ref=e23]: head-to-head collision contesting an aerial ball during a college soccer match
          - generic "2026-10-08" [ref=e24]:
            - paragraph [ref=e25]: When
            - paragraph [ref=e26]: 9 days ago
          - generic "9 of 12" [ref=e27]:
            - paragraph [ref=e28]: Week
            - paragraph [ref=e29]: 9 of 12
          - generic "right frontal" [ref=e30]:
            - paragraph [ref=e31]: Contusion
            - paragraph [ref=e32]: right frontal
          - generic "15" [ref=e33]:
            - paragraph [ref=e34]: GCS
            - paragraph [ref=e35]: "15"
        - generic [ref=e36]:
          - button "Call patient" [ref=e37] [cursor=pointer]
          - button "Print summary" [ref=e38] [cursor=pointer]
          - button "Evidence" [ref=e40] [cursor=pointer]
      - generic [ref=e43]:
        - generic [ref=e44]:
          - paragraph [ref=e45]:
            - generic [ref=e46]: "Updated from check-in on Oct 18, 2026:"
            - text: 100 regions moved, most of all RH_Default_PFCv_1 in the Default network, 0.05 lower. Drift is -0.3.
          - list [ref=e47]:
            - 'listitem "RH_Default_PFCv_1, Default: 0.240 to 0.192" [ref=e48]': RH_Default_PFCv_1Default-0.048
            - 'listitem "LH_Cont_Par_1, Cont: 0.227 to 0.182" [ref=e49]': LH_Cont_Par_1Cont-0.046
            - 'listitem "LH_Vis_4, Visual: 0.225 to 0.180" [ref=e50]': LH_Vis_4Visual-0.045
            - 'listitem "LH_Vis_5, Visual: 0.225 to 0.180" [ref=e51]': LH_Vis_5Visual-0.045
            - 'listitem "RH_Vis_4, Visual: 0.225 to 0.180" [ref=e52]': RH_Vis_4Visual-0.045
        - button "Dismiss this update" [ref=e53]
      - generic [ref=e57]:
        - complementary [ref=e58]:
          - generic [ref=e59]:
            - heading "Key facts" [level=2] [ref=e60]
            - generic [ref=e61]:
              - generic [ref=e62]: Week
              - generic [ref=e63]: 9 of 12
            - generic "Small right frontal cortical contusion measuring 9 x 6 mm with mild surrounding oedema. Two small foci of susceptibility in the right frontal white matter on SWI, consistent with microhaemorrhage. No extra-axial collection." [ref=e64]: MRI
            - generic "No acute intracranial haemorrhage, mass effect or midline shift. No skull fracture. Study is negative for acute traumatic injury." [ref=e67]: CT
            - generic [ref=e70]:
              - generic [ref=e71]: SWI foci
              - generic [ref=e72]: "2"
            - generic "ALERT-TBI decision cutoff 22 pg/mL. Not a reference interval." [ref=e73]:
              - generic [ref=e74]: GFAP
              - generic [ref=e75]: 412 pg/mL
            - generic "A covariate on the recovery rate. It does not change brain shape." [ref=e76]:
              - generic [ref=e77]: Genotype
              - generic [ref=e91]: APOE e3/e4, BDNF Val/Met
          - generic [ref=e92]:
            - heading "Flags (1 open)" [level=2] [ref=e93]
            - list [ref=e94]:
              - listitem [ref=e95]:
                - generic [ref=e96]: Drift
                - button "Week 5. Reality has been outside the forecast band toward worse for weeks 4, 5, drift z 2.4." [ref=e98]
                - button "Acknowledge" [ref=e102] [cursor=pointer]
          - generic [ref=e103]:
            - heading "Check-ins" [level=2] [ref=e104]
            - generic [ref=e105]:
              - generic [ref=e106]: Last
              - generic [ref=e107]: Oct 18, 2026
            - generic "Due 2026-10-25" [ref=e108]:
              - generic [ref=e109]: Next
              - generic [ref=e110]: 2026-10-25
            - generic "Share of weeks where the truth fell inside the 80% band. The target is 80%." [ref=e116]:
              - generic [ref=e117]: Band coverage
              - generic [ref=e118]: 33%
            - generic "Mean standardized residual of the last two weeks, signed so positive means worse than expected." [ref=e119]:
              - generic [ref=e120]: Drift z
              - generic [ref=e121]: "-0.31"
        - generic [ref=e122]:
          - generic [ref=e123]:
            - button "Damage" [pressed] [ref=e124]
            - button "Uncertainty" [ref=e126]
            - button "Healing" [ref=e128]
            - button "Simulated activity" [ref=e130]
            - button "Excitation and inhibition" [ref=e132]
            - button "Template against personal" [ref=e134]
            - button "Intervention what-if" [ref=e136]
            - button "Signal drivers" [ref=e138]
            - button "Damage difference" [ref=e140]
            - button "Vessels" [ref=e142]
          - generic [ref=e145]:
            - generic [ref=e149]:
              - group "Hemispheres" [ref=e150]:
                - button "Both" [pressed] [ref=e151]
                - button "Split" [ref=e152]
                - button "Left" [ref=e153]
                - button "Right" [ref=e154]
              - generic [ref=e155]:
                - button "Hologram on" [pressed] [ref=e156]
                - button "Motion on" [pressed] [ref=e160]
                - button "Tracts on" [pressed] [ref=e165]
                - button "Borders on" [pressed] [ref=e170]
                - button "Expand viewer" [ref=e174]
            - generic:
              - paragraph: Drag to rotate. Click a region to pin it.
          - generic [ref=e180]:
            - generic [ref=e181]: Week 0
            - slider "Week shown on the brain" [ref=e185]
            - generic [ref=e186]: measured
          - textbox "Find a region by name" [ref=e189]:
            - /placeholder: Find a region
          - generic [ref=e190]:
            - generic [ref=e191]:
              - button "Left" [ref=e192]
              - button "Right" [ref=e193]
              - button "Top" [ref=e194]
              - button "Front" [ref=e195]
              - button "Back" [ref=e196]
              - button "Under" [ref=e197]
              - button "Frontal" [ref=e199]
              - button "Parietal" [ref=e200]
              - button "Temporal" [ref=e201]
              - button "Occipital" [ref=e202]
              - button "Limbic" [ref=e203]
              - button "Insular" [ref=e204]
            - paragraph [ref=e205]: Week 0 is measured. The band around it is the filter's posterior.
        - complementary [ref=e206]:
          - generic [ref=e207]:
            - tablist [ref=e208]:
              - tab "Data" [ref=e209] [cursor=pointer]
              - tab "Analysis" [ref=e210] [cursor=pointer]
              - tab "Treatment" [active] [selected] [ref=e211] [cursor=pointer]
              - tab "Timeline" [ref=e212] [cursor=pointer]
            - tabpanel "Treatment" [ref=e213]:
              - generic [ref=e214]:
                - paragraph [ref=e215]: Hypothetical what-if on a network model. Not a treatment recommendation, not a prediction, and no dose is modelled.
                - textbox "Search the formulary" [ref=e219]
                - list
                - generic [ref=e220]:
                  - generic [ref=e221]:
                    - generic [ref=e222]: Effect size
                    - slider "How strongly to perturb the local gain" [ref=e227]
                    - generic [ref=e228]: "0.20"
                  - paragraph [ref=e229]: At 0.20 the most affected region's local gain moves by 20%. This is a modelling knob, not a dose.
                  - generic [ref=e230]:
                    - button "Simulate" [disabled]
  - region "Notifications alt+T"
```

# Test source

```ts
  1  | import { test } from "@playwright/test";
  2  | test.use({ viewport:{width:1500,height:1000}, deviceScaleFactor:2, launchOptions:{args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"]}});
  3  | test("treatment", async ({ page, request }) => {
  4  |   const pid = (await (await request.get("/api/patients")).json())[0].id;
  5  |   await page.goto(`/patients/${pid}`);
  6  |   await page.waitForTimeout(8000);
  7  |   await page.getByRole("tab", { name: /Treatment/i }).click();
  8  |   await page.waitForTimeout(2500);
> 9  |   await page.locator("aside").screenshot({ path: process.env.SHOT! });
     |                               ^ Error: locator.screenshot: Error: strict mode violation: locator('aside') resolved to 2 elements:
  10 | });
  11 | 
```
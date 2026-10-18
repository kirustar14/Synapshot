# What this rests on

Every claim the model makes, where it came from, and whether anybody checked.

**verified** means it was checked against the actual artefact in this repository or the
actual service this code calls, in a session whose output is reproducible by running the
command named. It does not mean the underlying science is settled.

**check this** means it is written from domain knowledge and has not been verified
against a source here. Some of these are almost certainly right. Some are the sort of
number that is right to within a factor of two. Treat the tag as the confidence, not the
prose.

Nothing in this file has been reviewed by a clinician. The whole system is a research
prototype on synthetic data and is not a medical device.

---

## Parcellation and surface

**Claim.** The cortex is divided into 100 regions using the Schaefer 7-network
parcellation, and the region order the connectome uses is the same order the surface
labels use.
**Source.** Schaefer A, Kong R, Gordon EM, Laumann TO, Zuo XN, Holmes AJ, Eickhoff SB,
Yeo BTT. *Local-Global Parcellation of the Human Cerebral Cortex from Intrinsic
Functional Connectivity MRI.* Cerebral Cortex 2018;28(9):3095–3114. Annotation files from
the CBIG release (`ThomasYeoLab/CBIG`, `Schaefer2018_LocalGlobal`).
**verified.** `backend/data/mesh.py` reads the CBIG `.annot` files and refuses them
unless the region names inside match `templates()["names"]` region for region, because a
silently permuted parcellation would paint damage on the wrong part of the brain and
still look plausible. Separately, the volumetric atlas's parcel centroids and
`templates()["xyz"]` are the same numbers to the millimetre, which is how the receptor
maps are known to land on the right parcels.

**Claim.** The surface is fsaverage5, 10242 vertices per hemisphere, and its vertices are
exactly the first 10242 of fsaverage7's 163842, in the same order.
**Source.** A property of FreeSurfer's recursive icosahedral subdivision.
**verified.** Checked against both spheres neuromaps ships
(`tpl-fsaverage_den-164k_hemi-L_sphere.surf.gii` and the 10k one): the largest angle
between a vertex and its counterpart is 0.04 degrees, which is float noise. This is what
lets the surface receptor maps be read without Connectome Workbench installed.

**Claim.** A region's centroid is a vertex on the surface, not the mean of its vertices.
**verified.** The arithmetic mean of a curved parcel's vertices sits inside the brain, by
up to 6.17 mm for the worst parcel here, which fails the 5 mm gate the viewer uses to put
a label on a region. The centroid is the parcel's own vertex nearest that mean.

---

## Network model

**Claim.** Regional activity is simulated with a dynamic mean field reduction of a
spiking excitatory–inhibitory network, with feedback inhibition tuned so every region's
excitatory population sits near a target firing rate.
**Source.** Deco G, Ponce-Alvarez A, Hagmann P, Romani GL, Mantini D, Corbetta M. *How
local excitation–inhibition ratio impacts the whole brain dynamics.* Journal of
Neuroscience 2014;34(23):7886–7898. doi:10.1523/JNEUROSCI.5068-13.2014
**check this.** The paper is the right one and the method is standard. The constants in
`backend/twin/dmf.py` (a 270, b 108, d 0.154, gamma 0.641/1000, tau_s 100 ms, w 0.9,
J_N 0.2609, I0 0.3, sigma 0.001) were written from memory and should be checked against
the paper or against `cubnm` before anyone trusts a number that comes out of them.

**Claim.** Functional connectivity is obtained analytically by solving a Lyapunov
equation for the linearised system rather than by correlating a long simulation.
**check this.** The approach is standard in this literature (Gilson and colleagues);
the specific linearisation in `fc_lin` has not been checked against a published
derivation.

**Claim.** Metastability is the standard deviation over time of the Kuramoto order
parameter of the regional phases.
**check this.** This is the usual definition in the whole-brain modelling literature
(Shanahan; Deco and colleagues). Not verified against a specific paper here.

**Claim.** `BASE = 0.07` peak strain for a reference impact is tuned so the mean damage
of a typical impact lands where the emulator summaries actually move.
**check this.** This is a tuning constant chosen to make the model's dynamic range
usable, not a measured strain. It is not a biomechanical claim and should not be read as
one.

---

## Receptor maps and the drug viewer

**Claim.** The twelve receptor and transporter maps are group-average PET and SPECT
images from healthy volunteers, parcellated onto Schaefer-100.
**Source.** The individual studies, which is what `neuromaps` ships and what this code
fetches:

| Target | Tracer | Study |
| --- | --- | --- |
| GABA-A | [11C]flumazenil | Nørgaard M et al., NeuroImage 2021;232:117878 |
| NMDA | [18F]GE-179 | Galovic M et al. (neuromaps `galovic2021`) |
| D1 | [11C]SCH23390 | Kaller S et al. (neuromaps `kaller2017`) |
| D2 | [11C]FLB457 | Sandiego CM et al. (neuromaps `sandiego2015`) |
| DAT | [123I]FP-CIT | Dukart J et al. (neuromaps `dukart2018`) |
| NET | [18F]MeNER | Ding YS et al. (neuromaps `ding2010`) |
| 5-HT1A | [11C]CUMI-101 | Beliveau V et al., J Neurosci 2017 |
| 5-HT2A | [11C]Cimbi-36 | Beliveau V et al., J Neurosci 2017 |
| 5-HTT | [11C]DASB | Beliveau V et al., J Neurosci 2017 |
| SV2A | [11C]UCB-J | Finnema SJ et al. (neuromaps `finnema2016`) |
| mGluR5 | [11C]ABP688 | Smart K et al. (neuromaps `smart2019`) |
| mu-opioid | [11C]carfentanil | Kantonen T et al., NeuroImage 2020;217:116922 |

The collection and its normative synthesis: Hansen JY, Shafiei G, Markello RD, et al.
*Mapping neurotransmitter systems to the structural and functional organization of the
human neocortex.* Nature Neuroscience 2022;25(11):1569–1581. doi:10.1038/s41593-022-01186-3
**verified.** All twelve load from real data: run
`python3 -c "from backend.twin import intervention; print(intervention.receptors()['sources'])"`
and it prints which study and which space each one came from. Four come through the
fsaverage surface and eight through the MNI152 volume, because only `norgaard2021` and
`beliveau2017` publish surface versions.

This correction is worth recording. The first version of `TARGETS` named a source called
`hansen22` with descriptors like `5ht2a`. There is no such source in neuromaps: the
Hansen 2022 paper is a synthesis of other people's studies, and neuromaps ships those
studies individually, keyed by radiotracer. Every lookup failed silently and all twelve
maps fell back to smooth noise, which would have made the entire drug viewer a plausible
looking random number generator. The keys above were checked against
`available_annotations()`.

**Claim.** A drug's effect is modelled as a receptor-weighted perturbation of each
region's local recurrent gain.
**Source.** Deco G, Cruzat J, Cabral J, Knudsen GM, Carhart-Harris RL, Whybrow PC,
Logothetis NK, Kringelbach ML. *Whole-Brain Multimodal Neuroimaging Model Using Serotonin
Receptor Maps Explains Non-linear Functional Effects of LSD.* Current Biology
2018;28(19):3065–3074. doi:10.1016/j.cub.2018.07.083
**check this.** The method is the one that paper introduced for 5-HT2A and LSD. Applying
it to a combination of transporters and receptors for a common clinical drug is an
extrapolation beyond what that paper demonstrates, and nobody has shown it predicts
anything about a person.

**Claim.** The affinity numbers in `backend/data/formulary.json` say how strongly a drug
acts at each target relative to its own main action.
**check this.** These are judgement calls, not binding constants, and they are not
comparable between drugs. They are weights on *where in the brain* the effect lands.
They are perturbed inside the ensemble precisely because they are uncertain.

**Claim.** The interval on a drug effect covers uncertainty in the patient's current
damage and in the affinity weights.
**verified.** `backend/twin/drugs.py` draws posterior members from the filter's own
ensemble and jitters the affinities per member. What it does not cover is stated in the
payload as `interval_misses`: the maps are group averages from tens of volunteers, the
gain perturbation is one representation among several, and the model may be wrong. For a
single-target drug the affinity scale is absorbed into the gain, so the interval narrows
to the posterior alone. Narrow is self-consistency, not confidence.

---

## Biomarkers

**Claim.** Serum GFAP and UCH-L1 are injury markers used here as covariates, with
decision cutoffs of 22 pg/mL and 327 pg/mL.
**Source.** Bazarian JJ, Biberthaler P, Welch RD, et al. *Serum GFAP and UCH-L1 for
prediction of absence of intracranial injuries on head CT (ALERT-TBI): a multicentre
observational study.* Lancet Neurology 2018;17(9):782–789.
**verified** for the cutoffs: 22 pg/mL (GFAP) and 327 pg/mL (UCH-L1), checked against the
published study. An earlier draft of `backend/synth/facts.py` wrote the GFAP cutoff as
100 pg/mL from memory, wrong by a factor of five, and the sample documents said so on the
page. Fixed.

Two things about how they are used here:
- These are **decision cutoffs for ruling out intracranial injury on CT**, not reference
  intervals. A value above one of them is a positive test, not an abnormal result.
- The z-scores the twin consumes use the synthetic generator's own scale
  (`GFAP_MEAN 120, SD 60`; `UCHL1_MEAN 290, SD 140` in `backend/ingest/apply.py`), which
  is **check this** and is not a clinical reference. A z there says where a value sits on
  this model's axis. It does not say whether a scan is needed.

**Claim.** Neurofilament light rises later after injury, so a value in range at 24 hours
is not reassuring.
**check this.** This is the usual description of NfL kinetics after TBI. No specific
reference verified here, and NfL is carried as a displayed value only: it has no z and
the model does not consume it.

---

## Genotype

**Claim.** APOE e4 carriage and BDNF Val66Met are covariates on the recovery rate.
**check this.** Both have a literature in TBI outcome and both are contested, with small
effects and inconsistent replication. They are in the model as covariates with wide
priors, and the population layer reports their fitted effects with intervals that
routinely include zero, which is the honest display of a contested effect.

**Claim, and this one is a design rule rather than a finding.** DNA does not change brain
shape. Genotype enters the recovery rate and nothing else.
**verified.** `backend/ingest/apply.py` writes genotype only into `alleles`, and
`test_genotype_changes_the_recovery_covariates_and_nothing_about_shape` asserts it writes
nothing into the injury or the geometry.

---

## What the call measures

**Claim.** Near point of convergence is receded in concussion, and 5 cm or more
discriminates concussed from control.
**Source.** Mucha A, Collins MW, Elbin RJ, Furman JM, Troutman-Enseki C, DeWolf RM,
Marchetti G, Kontos AP. *A Brief Vestibular/Ocular Motor Screening (VOMS) Assessment to
Evaluate Concussions: Preliminary Findings.* American Journal of Sports Medicine
2014;42(10):2479–2486.
**verified** for the 5 cm threshold and the study design (64 concussed patients about 5.5
days post-injury, 78 controls, AUC 0.89 for the combined model). The sample patient's
11 cm is therefore clearly receded. Note what the study is: 64 patients, preliminary
findings, adolescents.

**Claim.** Antisaccade error rate and saccade latency change after concussion.
**check this.** There is a literature on this and the direction is consistent, but no
specific effect size has been verified here, and the brief script's ten antisaccade
trials estimate the error rate with a standard error around 15 percentage points.

**Claim.** The seven red flag questions are in the style of the CDC HEADS UP materials.
**check this, and this one needs a clinician.** The question list in
`backend/agent/safety.py` carries a comment saying a clinician must confirm it before any
use outside the team. That comment is not decoration. Nobody has reviewed this list.

**Claim.** Camera latency can be estimated from a screen flash, and a session is rejected
when fewer than 8 of 10 flashes are detected or their spread exceeds 25 ms.
**verified** as an implementation: the estimator is
`median(brightness rise − flash drawn)` and it was measured against generated sessions
with a known true delay. The 25 ms gate is this project's own choice, not a published
threshold, and is **check this** as a standard.

**Claim.** Face and iris landmarks come from MediaPipe Face Landmarker, running on the
phone, and no video leaves the device.
**verified.** The model file is `web/public/models/face_landmarker.task`, downloaded by
`make models`. The call page posts `FrameRec` numbers and never frames.

---

## Filtering and forecasting

**Claim.** The recovery state is tracked with a 200 member ensemble Kalman filter with an
AR(1) discrepancy term.
**Source.** Evensen G, *Data Assimilation: The Ensemble Kalman Filter*, for the method.
**check this** for the discrepancy model, which is this project's choice.

**Claim.** The drift rule fires when the standardized residual stays above 2.0, signed
toward worse, for two consecutive weeks.
**verified** as implemented and tested, in `backend/alerts.py` and
`GET /api/alerts/{id}/explain`. The thresholds are this project's choice and are
**check this** as clinical rules. One bad week is noise and two in a row is a trend is a
reasonable design principle, not a validated rule.

**Claim.** The forecast bands are 80% intervals and the coverage target is 0.8.
**verified** as a calibration target the seed reports against. Coverage is measured on
synthetic data generated by the same model family that is being fitted, which is the
easiest possible test and says nothing about calibration on real patients.

---

## Vessels

**Claim.** The vessel layer shows the dural sinuses, the deep venous system, named
cortical veins including Trolard and Labbé, and the main arterial trunks.
**Source.** Standard descriptions of each vessel's course, placed by hand in MNI
millimetres in `backend/data/vessels.py`.
**check this.** This is a diagram at atlas scale. No angiogram went into it, nobody's
venous anatomy matches a textbook, and superficial venous anatomy varies more than almost
anything else in the head. The caption on the layer says "Schematic vessel layout from
anatomical atlases. Not patient-specific." and that is the whole claim.

The one point worth keeping: bridging veins enter the superior sagittal sinus against the
direction of flow, which is the usual explanation for why they tear in an acceleration
injury. That is why they are drawn.

---

## Honest limits

Read this part if you read nothing else.

1. **Every patient in this system is synthetic.** The six demo patients and the flagship
   are generated. No real person's data has been used anywhere, including in the sample
   document pack.

2. **The validation is circular.** The population layer recovers parameters from patients
   generated by the same model that is fitting them. That tests the implementation, not
   the model. It says nothing about whether this model describes human recovery.

3. **Nothing here has been shown to predict anything about a person.** There is no
   held-out clinical data, no comparison with an outcome measure, no prospective test.
   The forecasts are what the model believes, not what will happen.

4. **The drug viewer is a what-if, not advice.** No dose is modelled, no time course is
   modelled, and the mapping from a drug to a gain perturbation is an extrapolation
   beyond what the method it borrows has demonstrated. Several drugs on the formulary are
   marked not modelled, because the honest answer for them is that this has nothing to
   say.

5. **A rendered brain looks like a scan.** It is not one. Every viewer carries "Model
   output, not a scan", the vessels carry their own caption, and the shape slider says
   what the personal and the template ends of it mean.

6. **The measurements are from a phone camera held by a patient.** The quality gates are
   there because they are often not met. A call that fails them has its eye measures
   deleted rather than reported, which is the right behaviour and also means the band
   widens on exactly the weeks somebody was struggling most.

7. **The brief script trades accuracy for four minutes.** It does not run pursuit_v,
   saccade, near point of convergence, the oral motor tasks, the picture description or
   fluency, and it halves the antisaccade trials. Those features are absent for the week,
   not estimated badly. `?full=1` runs the whole protocol.

8. **No clinician has reviewed any of this.** Not the red flag list, not the thresholds,
   not the formulary, not the summaries. The code says so where it matters and this file
   says so here.

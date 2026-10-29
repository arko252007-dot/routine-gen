/**
 * Routine Gen - Hero Section & Landing Page Logic
 * 
 * Features:
 * - Card pointer spotlight tracking (--x, --y)
 * - Sticky nav scroll detection (hairline border on scroll)
 * - Active navigation link observer
 * - Smooth staggered scroll reveals
 * - Standalone client-side 3-Sheet Excel starter workbook generator
 * - JSON schema copier with visual feedback
 */

(function () {
  'use strict';

  // Mark JS enabled for scroll reveals
  document.documentElement.classList.add('js');

  // ── 1. Sticky Nav Hairline Border on Scroll ──────────────────────────────
  const heroNav = document.querySelector('.hero-nav');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 8) {
      heroNav?.classList.add('is-scrolled');
    } else {
      heroNav?.classList.remove('is-scrolled');
    }
  }, { passive: true });

  // ── 2. Card Pointer Spotlight Tracking ────────────────────────────────────
  document.querySelectorAll('.bento-card').forEach((card) => {
    card.addEventListener('pointermove', (e) => {
      const rect = card.getBoundingClientRect();
      card.style.setProperty('--x', (e.clientX - rect.left) + 'px');
      card.style.setProperty('--y', (e.clientY - rect.top) + 'px');
    });
  });

  // ── 3. Active Section Link Highlighting via IntersectionObserver ───────────
  const navLinks = document.querySelectorAll('.nav-link-custom');
  const sections = document.querySelectorAll('section[id]');
  
  if ('IntersectionObserver' in window && sections.length > 0) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const id = entry.target.getAttribute('id');
          navLinks.forEach((link) => {
            if (link.getAttribute('href') === `#${id}`) {
              link.classList.add('active');
            } else {
              link.classList.remove('active');
            }
          });
        }
      });
    }, { threshold: 0.25, rootMargin: '-80px 0px -40% 0px' });

    sections.forEach((sec) => observer.observe(sec));
  }

  // ── Lenis 60fps Momentum Scrolling & GSAP Integration ────────────────────
  let lenis = null;
  if (typeof Lenis !== 'undefined') {
    lenis = new Lenis({
      duration: 1.15,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      orientation: 'vertical',
      gestureOrientation: 'vertical',
      smoothWheel: true,
      wheelMultiplier: 1.0,
      touchMultiplier: 1.5,
      infinite: false
    });

    function raf(time) {
      lenis.raf(time);
      requestAnimationFrame(raf);
    }
    requestAnimationFrame(raf);
  }

  // ── GSAP & ScrollTrigger Dynamic Scroll Animations ────────────────────────
  if (typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined') {
    gsap.registerPlugin(ScrollTrigger);

    if (lenis) {
      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add((time) => {
        lenis.raf(time * 1000);
      });
      gsap.ticker.lagSmoothing(0);
    }

    const finaleSection = document.getElementById('finale-section');
    const heroNav = document.querySelector('.hero-nav');
    const ctaContent = document.querySelector('.cta-banner-content');

    // 1. Navbar Theme Synchronization:
    // The navbar MUST stay dark for the entire page (Hero, Modes, Problem, Workflow, Features, FAQ).
    // ONLY when #finale-section takes the full screen (i.e. reaches near the top of the viewport, rect.top <= 75),
    // does the navbar switch to white. When scrolling back up, it immediately reverts to dark.
    function syncNavWhiteTheme() {
      if (!finaleSection || !heroNav) return;
      const rect = finaleSection.getBoundingClientRect();
      if (rect.top <= 75) {
        heroNav.classList.add('nav-white-mode');
      } else {
        heroNav.classList.remove('nav-white-mode');
      }
    }

    if (lenis) {
      lenis.on('scroll', syncNavWhiteTheme);
    }
    window.addEventListener('scroll', syncNavWhiteTheme, { passive: true });
    syncNavWhiteTheme();

    // ── 0. Hero Text Subtle Incoming Animation on Open ──
    const heroTl = gsap.timeline({ defaults: { ease: 'power3.out' } });
    heroTl
      .fromTo('.hero-section .hero-title',
        { y: 38, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.9, delay: 0.12 }
      )
      .fromTo('.hero-section .hero-subtitle',
        { y: 24, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.8 },
        '-=0.65'
      )
      .fromTo('.hero-section .hero-cta-group',
        { y: 20, opacity: 0, scale: 0.96 },
        { y: 0, opacity: 1, scale: 1, duration: 0.75 },
        '-=0.55'
      )
      .fromTo('.hero-section .trust-badges-row',
        { y: 15, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.7 },
        '-=0.5'
      );

    // ── 1. Section Headers Text Spawn on Scroll ──
    ['#problem', '#modes', '#how-it-works', '#features', '#faq'].forEach((sectionId) => {
      const section = document.querySelector(sectionId);
      if (!section) return;

      const headerElements = section.querySelectorAll('.section-tag, .section-heading, .section-lead');
      if (headerElements.length > 0) {
        gsap.fromTo(headerElements,
          { y: 30, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.75,
            stagger: 0.12,
            ease: 'power3.out',
            immediateRender: false,
            scrollTrigger: {
              trigger: section,
              start: 'top 85%',
              toggleActions: 'play none none none',
              once: true
            }
          }
        );
      }
    });

    // ── 2. Problem Section Cards Stagger ──
    const problemCards = document.querySelectorAll('#problem .bento-card');
    if (problemCards.length > 0) {
      gsap.fromTo(problemCards,
        { y: 35, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.7,
          stagger: 0.1,
          ease: 'power3.out',
          immediateRender: false,
          scrollTrigger: {
            trigger: '#problem .row',
            start: 'top 85%',
            toggleActions: 'play none none none',
            once: true
          }
        }
      );
    }

    // ── 3. Interactive Modes Container Spawn ──
    const modesPills = document.querySelector('#modes .modes-nav-pills');
    const modesContent = document.querySelector('#modes .tab-content');
    if (modesPills && modesContent) {
      gsap.fromTo([modesPills, modesContent],
        { y: 30, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.75,
          stagger: 0.15,
          ease: 'power3.out',
          immediateRender: false,
          scrollTrigger: {
            trigger: '#modes',
            start: 'top 78%',
            toggleActions: 'play none none none',
            once: true
          }
        }
      );
    }

    // ── 4. How It Works (4-Step Workflow Cards) Stagger ──
    const stepCards = document.querySelectorAll('#how-it-works .bento-card, #how-it-works .how-step-card');
    if (stepCards.length > 0) {
      gsap.fromTo(stepCards,
        { y: 35, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.7,
          stagger: 0.1,
          ease: 'power3.out',
          immediateRender: false,
          scrollTrigger: {
            trigger: '#how-it-works',
            start: 'top 82%',
            toggleActions: 'play none none none',
            once: true
          }
        }
      );
    }

    // ── 5. Capabilities & Features (6 Cards) Stagger ──
    const featureCards = document.querySelectorAll('#features .bento-card');
    if (featureCards.length > 0) {
      gsap.fromTo(featureCards,
        { y: 30, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.65,
          stagger: 0.08,
          ease: 'power3.out',
          immediateRender: false,
          scrollTrigger: {
            trigger: '#features',
            start: 'top 82%',
            toggleActions: 'play none none none',
            once: true
          }
        }
      );
    }

    // ── 6. FAQ Accordion Items Stagger ──
    const faqItems = document.querySelectorAll('#faq .accordion-item');
    if (faqItems.length > 0) {
      gsap.fromTo(faqItems,
        { y: 25, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.6,
          stagger: 0.07,
          ease: 'power3.out',
          immediateRender: false,
          scrollTrigger: {
            trigger: '#faq',
            start: 'top 82%',
            toggleActions: 'play none none none',
            once: true
          }
        }
      );
    }

    // ── 7. Finale CTA Text & Buttons Entrance ──
    if (finaleSection && ctaContent) {
      const line1 = ctaContent.querySelector('.line-1');
      const line2 = ctaContent.querySelector('.line-2');
      const finaleSubtitle = ctaContent.querySelector('.hero-subtitle');
      const finaleBtnGroup = ctaContent.querySelector('.hero-cta-group');
      const finaleElements = [line1, line2, finaleSubtitle, finaleBtnGroup].filter(Boolean);

      if (finaleElements.length > 0) {
        gsap.fromTo(finaleElements,
          { y: 35, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.8,
            stagger: 0.12,
            ease: 'power3.out',
            immediateRender: false,
            scrollTrigger: {
              trigger: finaleSection,
              start: 'top 75%',
              toggleActions: 'play none none none',
              once: true
            }
          }
        );
      }
    }
  }

  // ── Pre-Flight Content Guarantee: Ensure all ScrollTriggers are properly calculated ──
  function ensureAllContentLoaded() {
    if (typeof ScrollTrigger !== 'undefined') {
      ScrollTrigger.refresh();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (typeof ScrollTrigger !== 'undefined') ScrollTrigger.refresh();
    });
  }

  window.addEventListener('load', () => {
    if (typeof ScrollTrigger !== 'undefined') {
      setTimeout(() => ScrollTrigger.refresh(), 100);
      setTimeout(() => ScrollTrigger.refresh(), 400);
    }
  });

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      if (typeof ScrollTrigger !== 'undefined') ScrollTrigger.refresh();
    });
  }

  // ── 5. Enhanced Smooth Scrolling for All In-Page Anchors ──────────────────
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', function (e) {
      const targetId = this.getAttribute('href');
      if (!targetId || targetId === '#') return;
      if (targetId === '#top') {
        e.preventDefault();
        if (lenis) {
          lenis.scrollTo(0, { duration: 1.2 });
        } else {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
        return;
      }

      // If linking to #modes or #excel, auto-switch to Excel Mode tab
      if (targetId === '#modes' || targetId === '#excel' || targetId === '#pane-excel') {
        const excelTabBtn = document.getElementById('tab-btn-excel');
        if (excelTabBtn) {
          if (window.bootstrap && window.bootstrap.Tab) {
            window.bootstrap.Tab.getOrCreateInstance(excelTabBtn).show();
          } else {
            excelTabBtn.click();
          }
        }
      }

      const targetEl = document.querySelector(targetId);
      if (targetEl) {
        e.preventDefault();
        if (lenis) {
          lenis.scrollTo(targetEl, { offset: -70, duration: 1.2 });
        } else {
          targetEl.scrollIntoView({ behavior: 'smooth' });
        }
      }
    });
  });

  // ── 6. Scroll Reveal Observer (Staggered Entrance) ────────────────────────
  if ('IntersectionObserver' in window) {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!prefersReducedMotion) {
      const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            revealObserver.unobserve(entry.target);
          }
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -10% 0px' });

      document.querySelectorAll('.reveal').forEach((el) => revealObserver.observe(el));
    }
  }

  // ── 5. 3-Sheet Excel Starter Workbook Generator ──────────────────────────
  function downloadHeroExcelTemplate() {
    if (typeof XLSX === 'undefined') {
      alert('SheetJS (XLSX) library is still loading. Please check your internet connection.');
      return;
    }

    try {
      const wb = XLSX.utils.book_new();

      // Sheet 1: Departments & Timing
      const timingData = [
        ['Department', 'Semester', 'Periods/Day', 'Period Duration (mins)', 'Start Time', 'Tiffin After Period #', 'Tiffin Duration (mins)'],
        ['BCA', 'Semester 1', 8, 45, '09:00', 4, 30],
        ['BCA', 'Semester 2', 8, 45, '10:00', 4, 30],
        ['BBA', 'Semester 1', 6, 50, '09:30', 3, 30],
        ['BBA', 'Semester 2', 6, 50, '09:30', 3, 30]
      ];
      const wsTiming = XLSX.utils.aoa_to_sheet(timingData);
      wsTiming['!cols'] = [
        { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 24 }, { wch: 14 }, { wch: 24 }, { wch: 24 }
      ];
      XLSX.utils.book_append_sheet(wb, wsTiming, 'Departments & Timing');

      // Sheet 2: Subjects & Labs
      const quickSubData = [
        ['Department', 'Semester', 'Subjects', 'Labs'],
        ['BCA', 'Semester 1', 'OS, DSA, Disaster Management', 'OS, DSA'],
        ['BCA', 'Semester 2', 'DBMS, Computer Networks, Software Engineering', 'DBMS, Computer Networks'],
        ['BBA', 'Semester 1', 'Principles of Management, Business Economics, Financial Accounting', ''],
        ['BBA', 'Semester 2', 'Marketing Management, Human Resource Management, Business Law', '']
      ];
      const wsQuickSub = XLSX.utils.aoa_to_sheet(quickSubData);
      wsQuickSub['!cols'] = [
        { wch: 16 }, { wch: 16 }, { wch: 54 }, { wch: 36 }
      ];
      XLSX.utils.book_append_sheet(wb, wsQuickSub, 'Subjects & Labs');

      // Sheet 3: Teachers
      const teacherData = [
        ['Name', 'Working Days', 'Available From', 'Available To'],
        ['Dr. Sharma', 'Monday, Tuesday, Wednesday, Thursday, Friday', '', ''],
        ['Prof. Banerjee', 'Monday, Wednesday, Friday', '10:00', '15:30'],
        ['Dr. Roy', 'Monday, Tuesday, Thursday, Friday', '', ''],
        ['Prof. Das', 'Tuesday, Wednesday, Thursday', '11:00', '16:00'],
        ['Dr. Mukherjee', 'Monday, Tuesday, Wednesday, Thursday, Friday', '', '']
      ];
      const wsTeacher = XLSX.utils.aoa_to_sheet(teacherData);
      wsTeacher['!cols'] = [
        { wch: 20 }, { wch: 48 }, { wch: 18 }, { wch: 18 }
      ];
      XLSX.utils.book_append_sheet(wb, wsTeacher, 'Teachers');

      XLSX.writeFile(wb, 'routine_gen_starter_template.xlsx');
    } catch (err) {
      console.error('Failed to generate Excel template:', err);
      alert('Error generating template: ' + err.message);
    }
  }

  // ── 6. Sample JSON Format for Quick Copy ──────────────────────────────────
  const SAMPLE_JSON_SNIPPET = {
    settings: {
      periods: 6,
      periodDuration: 45,
      startTime: "09:30",
      tiffinPeriod: 3,
      tiffinDuration: 30,
      workingDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
    },
    teachers: [
      { name: "Dr. Sharma", availableFrom: "09:30", availableTo: "16:00" },
      { name: "Prof. Banerjee", availableFrom: "10:30", availableTo: "15:30" }
    ],
    entries: [
      {
        department: "BCA",
        semester: "Semester 1",
        day: "Monday",
        period: 1,
        subject: "Data Structures",
        teacher: "Dr. Sharma",
        type: "Theory"
      },
      {
        department: "BCA",
        semester: "Semester 1",
        day: "Monday",
        period: 2,
        subject: "DSA Lab",
        teacher: "Prof. Banerjee",
        type: "Lab Extended"
      }
    ]
  };

  function copyJsonSample(triggerEl) {
    const jsonStr = JSON.stringify(SAMPLE_JSON_SNIPPET, null, 2);
    navigator.clipboard.writeText(jsonStr).then(() => {
      const copyBtn = triggerEl || document.querySelector('.js-copy-json-btn');
      if (copyBtn) {
        const originalHtml = copyBtn.innerHTML;
        copyBtn.innerHTML = '<i class="bi bi-check-lg text-success"></i> <span>Copied JSON!</span>';
        setTimeout(() => {
          copyBtn.innerHTML = originalHtml;
        }, 2200);
      }
    }).catch(err => {
      console.error('Clipboard copy failed:', err);
    });
  }

  // ── 7. DOMContentLoaded Bindings ──────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    // ── Wizard Step-by-Step Interactive Walkthrough ────────────────────────
    const wizardImg = document.getElementById('wizard-showcase-img');
    const wizardStepBtns = document.querySelectorAll('#wizard-steps-group .wizard-mini-step-btn');
    const wizardDesc = document.getElementById('wizard-step-description');
    const wizardCounter = document.getElementById('wizard-step-counter');
    const wizardBadge = document.getElementById('wizard-badge-step');
    const btnWizardPrev = document.getElementById('btn-wizard-prev');
    const btnWizardNext = document.getElementById('btn-wizard-next');

    let currentWizardStep = 1;

    function setWizardStep(stepNum) {
      currentWizardStep = stepNum;
      wizardStepBtns.forEach(b => {
        const step = parseInt(b.getAttribute('data-step') || '1', 10);
        if (step === currentWizardStep) {
          b.classList.add('active');
          const imgSrc = b.getAttribute('data-img');
          const descText = b.getAttribute('data-desc');
          if (wizardImg && imgSrc) wizardImg.src = imgSrc;
          if (wizardDesc && descText) wizardDesc.innerHTML = `<strong>Step ${step}:</strong> ` + descText.replace(/^Step \d+:\s*/, '');
        } else {
          b.classList.remove('active');
        }
      });

      if (wizardCounter) wizardCounter.textContent = `Step ${currentWizardStep} of 4`;
      if (wizardBadge) wizardBadge.textContent = `Step ${currentWizardStep} / 4`;

      if (btnWizardPrev) {
        btnWizardPrev.disabled = (currentWizardStep === 1);
      }
      if (btnWizardNext) {
        if (currentWizardStep === 4) {
          btnWizardNext.innerHTML = 'Start Over <i class="bi bi-arrow-repeat ms-1"></i>';
        } else {
          btnWizardNext.innerHTML = 'Next Step <i class="bi bi-chevron-right ms-1"></i>';
        }
      }
    }

    wizardStepBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const step = parseInt(btn.getAttribute('data-step') || '1', 10);
        setWizardStep(step);
      });
    });

    if (btnWizardPrev) {
      btnWizardPrev.addEventListener('click', () => {
        if (currentWizardStep > 1) {
          setWizardStep(currentWizardStep - 1);
        }
      });
    }

    if (btnWizardNext) {
      btnWizardNext.addEventListener('click', () => {
        if (currentWizardStep < 4) {
          setWizardStep(currentWizardStep + 1);
        } else {
          setWizardStep(1); // loop back
        }
      });
    }

    // ── Excel 3-Sheet Interactive Switcher ──────────────────────────────────
    const excelImg = document.getElementById('excel-showcase-img');
    const excelSheetBtns = document.querySelectorAll('#excel-sheets-group .excel-sheet-pill-btn');
    const excelDesc = document.getElementById('excel-sheet-description');
    const excelBadge = document.getElementById('excel-sheet-badge');

    excelSheetBtns.forEach((btn, idx) => {
      btn.addEventListener('click', () => {
        excelSheetBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const imgSrc = btn.getAttribute('data-img');
        const descText = btn.getAttribute('data-desc');
        if (excelImg && imgSrc) excelImg.src = imgSrc;
        if (excelDesc && descText) excelDesc.innerHTML = descText;
        if (excelBadge) excelBadge.textContent = `Sheet ${idx + 1} of 3`;
      });
    });

    // Download buttons
    document.querySelectorAll('.js-download-excel').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        downloadHeroExcelTemplate();
      });
    });

    // ── 9. Monumental Cursor-Reactive Proximity Typography ──────────────────
    initMonumentalFooterEffect();

    // ── 10. Wizard Transition Loading Screen (Beeping Logo) ─────────────────
    initWizardTransitionLoader();

    // ── 11. Deep Link Hash & Modes Switcher (Excel Guide Direct Open) ──────
    initHashNavigationAndModes();
  });

  /**
   * Interactive Proximity-Based Letter Fill
   * Fluid proximity interpolation across letters without a pointer follower dot
   */
  function initMonumentalFooterEffect() {
    const brandStage = document.getElementById('footer-brand-stage');
    const charElements = Array.from(document.querySelectorAll('.wordmark-char'));

    if (!brandStage || charElements.length === 0) return;

    // Respect prefers-reduced-motion
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    let charData = [];
    let isPointerInside = false;
    let targetX = 0;
    let targetY = 0;
    let cursorX = 0;
    let cursorY = 0;
    let animFrameId = null;

    function measure() {
      const stageRect = brandStage.getBoundingClientRect();
      charData = charElements.map((charEl) => {
        const rect = charEl.getBoundingClientRect();
        return {
          el: charEl,
          x: (rect.left + rect.width / 2) - stageRect.left,
          y: (rect.top + rect.height / 2) - stageRect.top,
          currentFill: parseFloat(charEl.style.getPropertyValue('--char-fill')) || 0,
          targetFill: 0,
          currentScale: 1,
          targetScale: 1,
          currentY: 0,
          targetY: 0
        };
      });
    }

    // Initial measurement + update on resize
    measure();
    window.addEventListener('resize', measure, { passive: true });

    function tick() {
      // 1. Smoothly interpolate cursor position towards pointer
      cursorX += (targetX - cursorX) * 0.22;
      cursorY += (targetY - cursorY) * 0.22;

      let hasActiveDelta = Math.abs(targetX - cursorX) > 0.5 || Math.abs(targetY - cursorY) > 0.5;

      const stageWidth = brandStage.clientWidth || 1200;
      // Proximity radius scales with screen size
      const influenceRadius = Math.max(170, stageWidth * 0.16);

      // 2. Compute proximity & lerp fills for each character
      charData.forEach((char) => {
        if (isPointerInside) {
          const dx = cursorX - char.x;
          const dy = (cursorY - char.y) * 1.25;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < influenceRadius) {
            const proximity = 1 - (dist / influenceRadius);
            char.targetFill = Math.min(1, Math.pow(proximity, 1.25));
            char.targetScale = 1 + (char.targetFill * 0.024);
            char.targetY = -char.targetFill * 2.8;
          } else {
            char.targetFill = 0;
            char.targetScale = 1;
            char.targetY = 0;
          }
        } else {
          char.targetFill = 0;
          char.targetScale = 1;
          char.targetY = 0;
        }

        // Smooth continuous interpolation (lerp)
        const fillDelta = char.targetFill - char.currentFill;
        const scaleDelta = char.targetScale - char.currentScale;
        const yDelta = char.targetY - char.currentY;

        char.currentFill += fillDelta * 0.16;
        char.currentScale += scaleDelta * 0.16;
        char.currentY += yDelta * 0.16;

        if (Math.abs(fillDelta) > 0.001 || Math.abs(scaleDelta) > 0.001) {
          hasActiveDelta = true;
        }

        // Apply CSS variables directly to character element
        char.el.style.setProperty('--char-fill', char.currentFill.toFixed(3));
        char.el.style.setProperty('--char-scale', char.currentScale.toFixed(3));
        char.el.style.setProperty('--char-y', char.currentY.toFixed(1) + 'px');
      });

      // Continue animation loop while delta exists or pointer is inside
      if (hasActiveDelta || isPointerInside) {
        animFrameId = requestAnimationFrame(tick);
      } else {
        // Reset to clean 0 and pause RAF loop to free CPU
        charData.forEach((char) => {
          char.currentFill = 0;
          char.currentScale = 1;
          char.currentY = 0;
          char.el.style.setProperty('--char-fill', '0');
          char.el.style.setProperty('--char-scale', '1');
          char.el.style.setProperty('--char-y', '0px');
        });
        animFrameId = null;
      }
    }

    function startLoop() {
      if (!animFrameId) {
        animFrameId = requestAnimationFrame(tick);
      }
    }

    function onPointerMove(e) {
      const stageRect = brandStage.getBoundingClientRect();
      targetX = e.clientX - stageRect.left;
      targetY = e.clientY - stageRect.top;

      if (!isPointerInside) {
        isPointerInside = true;
        cursorX = targetX;
        cursorY = targetY;
      }

      startLoop();
    }

    function onPointerLeave() {
      isPointerInside = false;
      startLoop();
    }

    brandStage.addEventListener('pointerenter', onPointerMove, { passive: true });
    brandStage.addEventListener('pointermove', onPointerMove, { passive: true });
    brandStage.addEventListener('pointerleave', onPointerLeave, { passive: true });

    // Touch support (tap or drag across letters)
    brandStage.addEventListener('touchmove', (e) => {
      if (e.touches && e.touches.length > 0) {
        const touch = e.touches[0];
        const stageRect = brandStage.getBoundingClientRect();
        targetX = touch.clientX - stageRect.left;
        targetY = touch.clientY - stageRect.top;
        if (!isPointerInside) {
          isPointerInside = true;
          cursorX = targetX;
          cursorY = targetY;
        }
        startLoop();
      }
    }, { passive: true });

    brandStage.addEventListener('touchend', () => {
      onPointerLeave();
    }, { passive: true });
  }

  /**
   * Wizard Transition Loading Screen
   * Intercepts "Build Routine" clicks to display a full-screen loading screen
   * with a beeping logo, radar pulse, and animated wizard setup text.
   */
  function initWizardTransitionLoader() {
    const loaderOverlay = document.getElementById('wizard-loader-overlay');
    if (!loaderOverlay) return;

    // Find all links targeting wizard.html
    const wizardLinks = document.querySelectorAll('a[href*="wizard.html"]');

    wizardLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        // Allow user to use middle click or Cmd/Ctrl/Shift to open in new tab
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.which === 2 || link.target === '_blank') {
          return;
        }

        e.preventDefault();
        const targetUrl = link.getAttribute('href') || 'wizard.html';

        try {
          sessionStorage.setItem('routine_gen_transition', 'true');
        } catch (err) {
          // ignore quota or security exceptions
        }

        // Show the loading screen overlay
        loaderOverlay.classList.add('active');
        loaderOverlay.setAttribute('aria-hidden', 'false');

        // Allow user to see the beeping animation and status (stay for at least 1.5s)
        const isReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const delay = isReduced ? 300 : 1600;

        setTimeout(() => {
          window.location.href = targetUrl;
        }, delay);
      });
    });

    // Reset overlay if user returns via browser back/forward cache
    window.addEventListener('pageshow', () => {
      if (loaderOverlay) {
        loaderOverlay.classList.remove('active');
        loaderOverlay.setAttribute('aria-hidden', 'true');
      }
    });
  }

  /**
   * Deep Link Hash & Modes Switcher
   * When navigating to index.html#modes, #excel, or with ?mode=excel,
   * automatically activates the "Excel Mode" pill tab and smoothly
   * scrolls down so the 3-sheet guide and screenshots are squarely in view.
   */
  function initHashNavigationAndModes() {
    function checkAndSwitchTab() {
      const hash = (window.location.hash || '').toLowerCase();
      const search = (window.location.search || '').toLowerCase();

      const isExcel = hash === '#modes' || hash === '#excel' || hash === '#pane-excel' || hash === '#modes-excel' || search.includes('mode=excel') || search.includes('excel');
      const isJson = hash === '#json' || hash === '#pane-json' || search.includes('mode=json') || search.includes('json');

      if (isExcel) {
        const excelTabBtn = document.getElementById('tab-btn-excel');
        if (excelTabBtn) {
          if (window.bootstrap && window.bootstrap.Tab) {
            window.bootstrap.Tab.getOrCreateInstance(excelTabBtn).show();
          } else {
            excelTabBtn.click();
          }
        }
        const modesSection = document.getElementById('modes');
        if (modesSection) {
          setTimeout(() => {
            if (lenis) {
              lenis.scrollTo(modesSection, { offset: -60, duration: 1.1 });
            } else {
              modesSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          }, 180);
        }
      } else if (isJson) {
        const jsonTabBtn = document.getElementById('tab-btn-json');
        if (jsonTabBtn) {
          if (window.bootstrap && window.bootstrap.Tab) {
            window.bootstrap.Tab.getOrCreateInstance(jsonTabBtn).show();
          } else {
            jsonTabBtn.click();
          }
        }
        const modesSection = document.getElementById('modes');
        if (modesSection) {
          setTimeout(() => {
            if (lenis) {
              lenis.scrollTo(modesSection, { offset: -60, duration: 1.1 });
            } else {
              modesSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          }, 180);
        }
      }
    }

    // Check immediately on DOM load
    checkAndSwitchTab();

    // Re-check on window load after fonts and images render
    window.addEventListener('load', () => {
      if (window.location.hash) {
        checkAndSwitchTab();
      }
    });

    // Handle hash change while page is already active
    window.addEventListener('hashchange', checkAndSwitchTab);
  }

  // Global export
  window.downloadHeroExcelTemplate = downloadHeroExcelTemplate;
  window.copyJsonSample = copyJsonSample;
})();

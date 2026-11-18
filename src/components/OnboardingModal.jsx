import React, { useState, useEffect } from 'react';
import './OnboardingModal.css';

const REVIEWER_STEPS = [
  {
    id: 'welcome',
    title: 'Welcome to FrameCheck',
    badge: 'Desktop-First Image Review',
    desc: 'FrameCheck delivers high-precision, desktop-first collaborative visual inspection. Mark defects, communicate feedback clearly, and align your team in real time.',
    icon: (
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="4" />
        <circle cx="12" cy="12" r="4.5" />
      </svg>
    ),
    tips: [
      'Navigate between batch images using PageUp/PageDown or thumbnails.',
      'Zoom smoothly with mouse wheel, space-drag to pan, or press 0 to Auto-Fit.',
    ],
  },
  {
    id: 'tools',
    title: 'Precision Annotation Tools',
    badge: '15 Vector Drawing Tools',
    desc: 'Select from 15 drawing tools including Circles (C), Arrows (A), Rectangles (R), Clouds (U), Callouts (T), Textboxes (X), and Magnifier Loupe (Z).',
    icon: (
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 19l7-7 3 3-7 7-3-3z" />
        <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
        <path d="M2 2l7.586 7.586" />
        <circle cx="11" cy="11" r="2" />
      </svg>
    ),
    tips: [
      'All keyboard shortcuts can be viewed and customized via the Shortcuts (⌨) button.',
      'System-reserved browser shortcuts are safely protected.',
    ],
  },
  {
    id: 'comments_priority',
    title: 'Explanations, Assignment & Priority',
    badge: 'Accountable Feedback',
    desc: 'Every created marking requires an explanation comment so team members understand exactly what needs fixing. Assign issues directly to team members and designate priority levels.',
    icon: (
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        <path d="M12 7v4M12 15h.01" />
      </svg>
    ),
    tips: [
      'Use @mentions in discussions to notify specific reviewers.',
      'Mark checklist tasks directly within the review sidebar to track completion.',
    ],
  },
  {
    id: 'layers_templates',
    title: 'Layers & Reusable Templates',
    badge: 'Style Standardization',
    desc: 'Organize markup by disciplines (Copy, Layout, Polish) on distinct layers. Save your styling into Reusable Templates (📋) or apply existing presets in a single click.',
    icon: (
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 2 7 12 12 22 7 12 2" />
        <polyline points="2 17 12 22 22 17" />
        <polyline points="2 12 12 17 22 12" />
      </svg>
    ),
    tips: [
      'Applying a template to a selected marking updates style while preserving position and geometry.',
      'Layers can be locked or hidden to prevent unintentional edits.',
    ],
  },
  {
    id: 'focus_presentation',
    title: 'Focus & Presentation Modes',
    badge: 'Distraction-Free Inspection',
    desc: 'Press F to collapse sidebar panels into Focus Mode. When sharing screens in review meetings, switch to Presentation Mode (📺) for an uncluttered canvas.',
    icon: (
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
    tips: [
      'Presentation mode keeps markings clear while hiding editing toolbars.',
      'Press Esc anytime to return to the standard review workspace.',
    ],
  },
  {
    id: 'autosave_export',
    title: 'Resilient Autosave & Export',
    badge: 'Protected Work & Deliverables',
    desc: 'Edits automatically save with network interruption retry resilience. Download full-resolution annotated images (PNG/JPEG/WebP) or generate comprehensive PDF reports.',
    icon: (
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
        <polyline points="17 21 17 13 7 13 7 21" />
        <polyline points="7 3 7 8 15 8" />
      </svg>
    ),
    tips: [
      'Toolbar badge displays live status (✓ Saved, ⏳ Saving…, ⚠️ Save Failed).',
      'Export Annotated Image downloads native-resolution files with vector markings.',
    ],
  },
];

const UPLOADER_STEPS = [
  {
    id: 'welcome_uploader',
    title: 'Welcome to FrameCheck',
    badge: 'Monitor Review Feedback',
    desc: 'Track and inspect reviewer feedback across all your uploaded batch images. Watch visual markings and required explanations update in real time.',
    icon: (
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="4" />
        <circle cx="12" cy="12" r="4.5" />
      </svg>
    ),
    tips: [
      'Switch between images easily using the thumbnails rail on the left.',
      'Zoom into image details with the mouse wheel or click 1:1 Actual Size.',
    ],
  },
  {
    id: 'inspect_markings',
    title: 'Inspect Reviewer Markings',
    badge: 'Clear, Contextual Revisions',
    desc: 'Reviewers place numbered markings directly on images. Click any marking or corresponding card in the sidebar to review comments and required corrections.',
    icon: (
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
    ),
    tips: [
      'Filter between Open and Resolved items in the review sidebar.',
      'Check priority indicators (Urgent, High, Medium, Low) to prioritize fixes.',
    ],
  },
  {
    id: 'presence_realtime',
    title: 'Live Collaboration & Tracking',
    badge: 'Real-Time Sync',
    desc: 'See which reviewers are actively inspecting your images with presence chips in the header, live cursor tracking, and instant discussion updates.',
    icon: (
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    tips: [
      'Click a reviewer presence chip to follow their viewport as they inspect.',
      'Reply in annotation discussions to ask clarifying questions.',
    ],
  },
  {
    id: 'export_reports',
    title: 'Export Images & PDF Reports',
    badge: 'Audit & Deliverables',
    desc: 'Download full-resolution images with annotations cleanly rendered (PNG/JPEG), or generate official PDF reports summarizing all batch markings.',
    icon: (
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    ),
    tips: [
      'Click "Export Annotated Image" in the header to download high-res files.',
      'Use the Batch PDF button on the batch page to generate a full progress report.',
    ],
  },
];

export function OnboardingModal({
  isOpen,
  onClose,
  userRole = 'reviewer',
  userId = 'guest',
  onComplete,
}) {
  const steps = userRole === 'uploader' ? UPLOADER_STEPS : REVIEWER_STEPS;
  const [currentStep, setCurrentStep] = useState(0);
  const [dontShowAgain, setDontShowAgain] = useState(true);

  useEffect(() => {
    if (isOpen) {
      setCurrentStep(0);
    }
  }, [isOpen]);

  // Handle escape key for dismissal matching Preferences modal
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const step = steps[currentStep] || steps[0];
  const isLastStep = currentStep === steps.length - 1;

  const handleFinish = () => {
    if (dontShowAgain && typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(`fc_onboarding_completed_${userId || 'guest'}`, 'true');
      } catch {}
    }
    onComplete?.(dontShowAgain);
    onClose();
  };

  const handleNext = () => {
    if (isLastStep) {
      handleFinish();
    } else {
      setCurrentStep((prev) => Math.min(steps.length - 1, prev + 1));
    }
  };

  const handlePrev = () => {
    setCurrentStep((prev) => Math.max(0, prev - 1));
  };

  return (
    <div
      className="fc-modal-overlay fc-onboarding-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fc-onboarding-title"
    >
      <div className="fc-onboarding-modal">
        {/* Header matching Preferences design system */}
        <div className="fc-onboarding-header">
          <div className="fc-onboarding-header-left">
            <div className="fc-onboarding-title-row">
              <h2 id="fc-onboarding-title" className="fc-onboarding-title">
                Onboarding & Workflow Guide
              </h2>
              <span className="fc-onboarding-header-badge">{step.badge}</span>
            </div>
            <p className="fc-onboarding-subtitle">
              Step {currentStep + 1} of {steps.length} • {userRole === 'uploader' ? 'Uploader Feedback Inspection' : 'Reviewer Annotation Workflow'}
            </p>
          </div>
          <button
            type="button"
            className="fc-onboarding-close-btn"
            onClick={onClose}
            aria-label="Close guide"
          >
            ×
          </button>
        </div>

        {/* Slide Body */}
        <div className="fc-onboarding-body">
          <div className="fc-onboarding-icon-wrap" aria-hidden="true">
            {step.icon}
          </div>

          <h3 className="fc-onboarding-step-title">
            {step.title}
          </h3>

          <p className="fc-onboarding-step-desc">{step.desc}</p>

          {step.tips && step.tips.length > 0 ? (
            <div className="fc-onboarding-tips-card">
              <span className="fc-onboarding-tips-label">💡 Key Workflow Tips:</span>
              <ul className="fc-onboarding-tips-list">
                {step.tips.map((tip, idx) => (
                  <li key={idx}>{tip}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Step dots indicator */}
          <div className="fc-onboarding-dots" role="tablist" aria-label="Tour steps">
            {steps.map((s, idx) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={currentStep === idx}
                aria-label={`Jump to step ${idx + 1}: ${s.title}`}
                className={`fc-onboarding-dot ${currentStep === idx ? 'is-active' : ''}`}
                onClick={() => setCurrentStep(idx)}
              />
            ))}
          </div>
        </div>

        {/* Footer Navigation matching Preferences layout and button styling */}
        <div className="fc-onboarding-footer">
          <div className="fc-onboarding-footer-left">
            <label className="fc-onboarding-checkbox-label">
              <input
                type="checkbox"
                checked={dontShowAgain}
                onChange={(e) => setDontShowAgain(e.target.checked)}
              />
              <span>Don&apos;t show this guide on startup</span>
            </label>
          </div>

          <div className="fc-onboarding-footer-actions">
            {currentStep > 0 ? (
              <button
                type="button"
                className="fc-btn fc-btn-secondary fc-btn-sm"
                onClick={handlePrev}
              >
                Back
              </button>
            ) : (
              <button
                type="button"
                className="fc-btn fc-btn-secondary fc-btn-sm"
                onClick={handleFinish}
              >
                Skip Tour
              </button>
            )}

            <button
              type="button"
              className="fc-btn fc-btn-primary fc-btn-sm"
              onClick={handleNext}
            >
              {isLastStep ? 'Get Started' : 'Next →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


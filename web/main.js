document.addEventListener('DOMContentLoaded', function () {
    var navbar = document.querySelector('.navbar');
    var mobileBtn = document.getElementById('mobileMenuBtn');
    var navLinks = document.querySelector('.nav-links');

    // Smooth scroll for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(function (link) {
        link.addEventListener('click', function (e) {
            var targetId = this.getAttribute('href');
            if (targetId === '#') return;
            var target = document.querySelector(targetId);
            if (target) {
                e.preventDefault();
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                // Close mobile menu if open
                if (navLinks && navLinks.classList.contains('open')) {
                    navLinks.classList.remove('open');
                    if (mobileBtn) mobileBtn.classList.remove('active');
                }
            }
        });
    });

    // Navbar glass effect on scroll
    window.addEventListener('scroll', function () {
        if (window.pageYOffset > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    });

    // Mobile menu toggle
    if (mobileBtn && navLinks) {
        mobileBtn.addEventListener('click', function () {
            navLinks.classList.toggle('open');
            mobileBtn.classList.toggle('active');
        });
    }

    // FAQ accordion
    document.querySelectorAll('.faq-question').forEach(function (button) {
        button.addEventListener('click', function () {
            var isExpanded = this.getAttribute('aria-expanded') === 'true';
            var item = this.closest('.faq-item');
            // Close all
            document.querySelectorAll('.faq-question').forEach(function (b) {
                b.setAttribute('aria-expanded', 'false');
                b.closest('.faq-item').querySelector('.faq-answer').classList.remove('open');
            });
            // Open current if it was closed
            if (!isExpanded) {
                this.setAttribute('aria-expanded', 'true');
                item.querySelector('.faq-answer').classList.add('open');
            }
        });
    });

    // Scroll-triggered fade-in animation
    if ('IntersectionObserver' in window) {
        var observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add('animate-in');
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.1 });

        document.querySelectorAll(
            '.feature-card, .testimonial-card, .price-card, .showcase-item'
        ).forEach(function (el) {
            observer.observe(el);
        });
    }
});

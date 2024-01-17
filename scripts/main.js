window.addEventListener('scroll', function() {
    var navbar = document.querySelector('.navbar');
    
    if (window.scrollY > 30 * window.innerHeight / 100) {
        navbar.classList.add('navbar-scrolled');
    } else {
        navbar.classList.remove('navbar-scrolled');
    }
});

function scrollToSection(sectionId) {
    toggle();
    const section = document.querySelector(sectionId);
    const offset = document.getElementById("navigator").getBoundingClientRect().height;
    if (section) {
        window.scrollTo({
        top: section.offsetTop - offset,
        behavior: 'smooth'
        });
    }
}

function toggle(){
    const navbarButton = document.querySelector('.navbar-toggler');
    const ariaExpandedAttribute = navbarButton.getAttribute('aria-expanded');

    if (ariaExpandedAttribute === "true") {
      navbarButton.click();
    }
}
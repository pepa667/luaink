let sections = document.querySelectorAll('section');
let mainContent = document.querySelector('main');

mainContent.onscroll = () => {

  sections.forEach ( sec => {

    let top = mainContent.scrollTop;
    let offset = sec.offsetTop - 150;
    let height = sec.offsetHeight;

    if (top >= offset && top < offset + height) {

      sec.classList.add('animate');

    } else {

      sec.classList.remove('animate');

    }

  });

}
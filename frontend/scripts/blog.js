// BLOG DATA
let BLOG_POSTS = [];

async function initBlog() {
    try {
        const response = await fetch("assets/data/blog-posts.json");
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        BLOG_POSTS = await response.json();
    } catch (error) {
        console.error("Error loading blog posts:", error);
        if (window.showToast) {
            window.showToast("Failed to load blog articles. Please try again later.", "error");
        }
    }
    renderBlogPosts();
}

let currentCategory = "all";
let searchQuery = "";

// DOM ELEMENTS
const blogGrid = document.getElementById("blog-grid");
const searchInput = document.getElementById("blog-search");
const categoryButtons = document.querySelectorAll(".category-btn");
const blogModal = document.getElementById("blog-modal");
const blogModalClose = document.getElementById("blog-modal-close");
const blogModalBody = document.getElementById("blog-modal-body");
const newsletterBtn = document.getElementById("newsletter-btn");
const newsletterEmail = document.getElementById("newsletter-email");


function renderBlogPosts() {
    // Filter posts
    const filteredPosts = BLOG_POSTS.filter(post => {
        const matchesCategory = currentCategory === "all" || post.category === currentCategory;
        const matchesSearch = post.title.toLowerCase().includes(searchQuery) ||
                              post.excerpt.toLowerCase().includes(searchQuery) ||
                              post.category.toLowerCase().includes(searchQuery);
        return matchesCategory && matchesSearch;
    });

    blogGrid.innerHTML = "";

    if (filteredPosts.length === 0) {
        const noResults = document.createElement("div");
        noResults.className = "no-results";
        
        const frownIcon = document.createElement("i");
        frownIcon.className = "far fa-frown";
        
        const message = document.createElement("p");
        message.textContent = "No articles found matching your criteria.";
        
        const resetBtn = document.createElement("button");
        resetBtn.textContent = "Reset Filters";
        resetBtn.addEventListener("click", () => {
            if (window.resetFilters) window.resetFilters();
        });
        
        noResults.appendChild(frownIcon);
        noResults.appendChild(message);
        noResults.appendChild(resetBtn);
        blogGrid.appendChild(noResults);
        return;
    }

    // Render cards
    filteredPosts.forEach(post => {
        const card = document.createElement("div");
        card.className = "blog-card";
        card.setAttribute("data-id", post.id);

        const imgDiv = document.createElement("div");
        imgDiv.className = "blog-img";
        
        const img = document.createElement("img");
        img.src = post.image;
        img.alt = post.title;
        img.loading = "lazy";
        
        const dateSpan = document.createElement("span");
        dateSpan.className = "blog-date";
        dateSpan.textContent = post.date;
        
        imgDiv.appendChild(img);
        imgDiv.appendChild(dateSpan);

        const detailsDiv = document.createElement("div");
        detailsDiv.className = "blog-details";

        const metaDiv = document.createElement("div");
        metaDiv.className = "blog-meta";
        
        const categorySpan = document.createElement("span");
        categorySpan.className = `category-tag ${post.category}`;
        categorySpan.textContent = post.category;
        
        const readTimeSpan = document.createElement("span");
        readTimeSpan.className = "read-time";
        
        const clockIcon = document.createElement("i");
        clockIcon.className = "far fa-clock";
        readTimeSpan.appendChild(clockIcon);
        readTimeSpan.appendChild(document.createTextNode(` ${post.readTime}`));
        
        metaDiv.appendChild(categorySpan);
        metaDiv.appendChild(readTimeSpan);

        const titleH4 = document.createElement("h4");
        titleH4.textContent = post.title;

        const excerptP = document.createElement("p");
        excerptP.textContent = post.excerpt;

        const readMoreBtn = document.createElement("button");
        readMoreBtn.className = "read-more-btn";
        readMoreBtn.setAttribute("data-id", post.id);
        readMoreBtn.setAttribute("aria-label", `Continue reading ${post.title}`);
        readMoreBtn.appendChild(document.createTextNode("CONTINUE READING "));
        
        const arrowIcon = document.createElement("i");
        arrowIcon.className = "fas fa-arrow-right";
        readMoreBtn.appendChild(arrowIcon);
        
        readMoreBtn.addEventListener("click", () => {
            openArticleModal(post.id);
        });

        detailsDiv.appendChild(metaDiv);
        detailsDiv.appendChild(titleH4);
        detailsDiv.appendChild(excerptP);
        detailsDiv.appendChild(readMoreBtn);

        card.appendChild(imgDiv);
        card.appendChild(detailsDiv);
        blogGrid.appendChild(card);
    });
}

function bindStaticReadMoreButtons() {
    const buttons = document.querySelectorAll(".read-more-btn");
    buttons.forEach(btn => {
        btn.addEventListener("click", () => {
            const postId = parseInt(btn.getAttribute("data-id"));
            openArticleModal(postId);
        });
    });
}

function openArticleModal(id) {
    const post = BLOG_POSTS.find(p => p.id === id);
    if (!post) return;

    blogModalBody.innerHTML = "";

    const heroImg = document.createElement("img");
    heroImg.className = "modal-hero-img";
    heroImg.src = post.image;
    heroImg.alt = post.title;
    blogModalBody.appendChild(heroImg);

    const metaDiv = document.createElement("div");
    metaDiv.className = "modal-meta";
    
    const categorySpan = document.createElement("span");
    categorySpan.className = `category-tag ${post.category}`;
    categorySpan.textContent = post.category;
    
    const dotSpan1 = document.createElement("span");
    dotSpan1.textContent = "•";
    
    const dateSpan = document.createElement("span");
    dateSpan.textContent = post.date;
    
    const dotSpan2 = document.createElement("span");
    dotSpan2.textContent = "•";
    
    const readTimeSpan = document.createElement("span");
    const clockIcon = document.createElement("i");
    clockIcon.className = "far fa-clock";
    readTimeSpan.appendChild(clockIcon);
    readTimeSpan.appendChild(document.createTextNode(` ${post.readTime}`));
    
    metaDiv.appendChild(categorySpan);
    metaDiv.appendChild(dotSpan1);
    metaDiv.appendChild(dateSpan);
    metaDiv.appendChild(dotSpan2);
    metaDiv.appendChild(readTimeSpan);
    blogModalBody.appendChild(metaDiv);

    const titleH2 = document.createElement("h2");
    titleH2.className = "modal-title";
    titleH2.textContent = post.title;
    blogModalBody.appendChild(titleH2);

    const authorDiv = document.createElement("div");
    authorDiv.className = "modal-author-info";
    
    const avatarImg = document.createElement("img");
    avatarImg.className = "author-avatar";
    avatarImg.src = post.authorAvatar;
    avatarImg.alt = post.author;
    
    const authorDetails = document.createElement("div");
    authorDetails.className = "author-details";
    
    const authorName = document.createElement("span");
    authorName.className = "author-name";
    authorName.textContent = post.author;
    
    const authorTitle = document.createElement("span");
    authorTitle.className = "author-title";
    authorTitle.textContent = post.authorTitle;
    
    authorDetails.appendChild(authorName);
    authorDetails.appendChild(authorTitle);
    
    authorDiv.appendChild(avatarImg);
    authorDiv.appendChild(authorDetails);
    blogModalBody.appendChild(authorDiv);

    const textDiv = document.createElement("div");
    textDiv.className = "modal-text";
    textDiv.innerHTML = window.DOMPurify 
        ? DOMPurify.sanitize(post.content) 
        : window.AppUtils ? AppUtils.escapeHTML(post.content) : post.content.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    blogModalBody.appendChild(textDiv);

    const shareDiv = document.createElement("div");
    shareDiv.className = "modal-share";
    
    const shareSpan = document.createElement("span");
    shareSpan.textContent = "Share Article:";
    shareDiv.appendChild(shareSpan);

    const sharePlatforms = [
        { name: "twitter", class: "fab fa-twitter", label: "Share on Twitter" },
        { name: "facebook", class: "fab fa-facebook-f", label: "Share on Facebook" },
        { name: "linkedin", class: "fab fa-linkedin-in", label: "Share on Linkedin" }
    ];

    sharePlatforms.forEach(platform => {
        const btn = document.createElement("button");
        btn.className = "share-btn";
        btn.setAttribute("aria-label", platform.label);
        const icon = document.createElement("i");
        icon.className = platform.class;
        btn.appendChild(icon);
        
        btn.addEventListener("click", () => {
            if (window.shareArticle) {
                window.shareArticle(platform.name, post.title);
            }
        });
        shareDiv.appendChild(btn);
    });

    const copyBtn = document.createElement("button");
    copyBtn.className = "share-btn";
    copyBtn.setAttribute("aria-label", "Copy article link");
    const linkIcon = document.createElement("i");
    linkIcon.className = "fas fa-link";
    copyBtn.appendChild(linkIcon);
    copyBtn.addEventListener("click", () => {
        if (window.copyLink) {
            window.copyLink();
        }
    });
    shareDiv.appendChild(copyBtn);

    blogModalBody.appendChild(shareDiv);

    blogModal.classList.add("active");
    document.body.style.overflow = "hidden";
}

// CLOSE MODAL
function closeArticleModal() {
    blogModal.classList.remove("active");
    document.body.style.overflow = ""; 
}

// RESET FILTERS
window.resetFilters = function() {
    currentCategory = "all";
    searchQuery = "";
    if (searchInput) searchInput.value = "";
    
    categoryButtons.forEach(btn => {
        if (btn.getAttribute("data-category") === "all") {
            btn.classList.add("active");
        } else {
            btn.classList.remove("active");
        }
    });

    renderBlogPosts();
};

// SHARE & LINK COPY MOCKS
window.shareArticle = function(platform, title) {
    const url = window.location.href;
    let shareUrl = "";
    if (platform === "twitter") {
        shareUrl = `https://twitter.com/intent/tweet?text=${title}&url=${url}`;
    } else if (platform === "facebook") {
        shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${url}`;
    } else if (platform === "linkedin") {
        shareUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${url}`;
    }
    window.open(shareUrl, "_blank", "width=600,height=400");
};

window.copyLink = function() {
    navigator.clipboard.writeText(window.location.href).then(() => {
        if (window.showToast) {
            window.showToast("Article link copied to clipboard!", "success");
        } else {
            alert("Article link copied to clipboard!");
        }
    }).catch(err => {
        console.error("Could not copy text: ", err);
    });
};

document.addEventListener("DOMContentLoaded", () => {
    initBlog();
    bindStaticReadMoreButtons();

    categoryButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            categoryButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            currentCategory = btn.getAttribute("data-category");
            renderBlogPosts();
        });
    });

    // Live search input
    if (searchInput) {
        searchInput.addEventListener("input", (e) => {
            searchQuery = e.target.value.toLowerCase().trim();
            renderBlogPosts();
        });
    }

    // Close modal triggers
    if (blogModalClose) {
        blogModalClose.addEventListener("click", closeArticleModal);
    }

    if (blogModal) {
        blogModal.addEventListener("click", (e) => {
            if (e.target === blogModal) {
                closeArticleModal();
            }
        });
    }

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && blogModal.classList.contains("active")) {
            closeArticleModal();
        }
    });

    // Newsletter submit handler
    if (newsletterBtn && newsletterEmail) {
        newsletterBtn.addEventListener("click", (e) => {
            e.preventDefault();
            const email = newsletterEmail.value.trim();
            if (!email) {
                if (window.showToast) {
                    window.showToast("Please enter a valid email address.", "warning");
                } else {
                    alert("Please enter a valid email address.");
                }
                return;
            }
            
            // Email regex validation
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                if (window.showToast) {
                    window.showToast("Please enter a valid email address format.", "error");
                } else {
                    alert("Please enter a valid email address format.");
                }
                return;
            }

            // Success feedback
            if (window.showToast) {
                window.showToast("Thank you! You have successfully subscribed to our newsletter.", "success");
            } else {
                alert("Thank you! You have successfully subscribed to our newsletter.");
            }
            newsletterEmail.value = "";
        });
    }
});